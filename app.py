from flask import Flask, render_template, request, redirect, session
import sqlite3, os
from werkzeug.utils import secure_filename
import pandas as pd
from datetime import date
import qrcode
from flask import send_file
from PIL import Image, ImageDraw, ImageFont
import io


app = Flask(__name__)
app.secret_key = "secret123"

UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


def db():
    return sqlite3.connect('database.db')


# ================= INIT DB =================
def init_db():
    conn = db()
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    expiry TEXT,
    whatsapp TEXT,
    address TEXT,
    banner TEXT
)''')

    c.execute('''CREATE TABLE IF NOT EXISTS menu (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        item TEXT,
        price TEXT,
        category TEXT,
        image TEXT
    )''')

    conn.commit()
    conn.close()


init_db()


# ================= SEED MENU =================
def seed_menu(user_id):
    conn = db()
    c = conn.cursor()

    menu_items = [
        ("Virgin Mojito", "120", "Mocktail"),
        ("Blue Lagoon", "140", "Mocktail"),

        ("Veg Soup", "90", "Soup"),
        ("Chicken Soup", "120", "Soup"),

        ("Veg Chowmein", "120", "Chinese"),
        ("Chicken Chowmein", "150", "Chinese"),
        ("Chilli Chicken", "180", "Chinese"),

        ("Veg Fried Rice", "130", "Rice"),
        ("Chicken Fried Rice", "160", "Rice"),

        ("Chicken Biryani", "200", "Biryani"),
        ("Mutton Biryani", "280", "Biryani"),

        ("Paneer Tikka", "180", "Starter"),
        ("Chicken Tikka", "220", "Starter"),
    ]

    for item, price, category in menu_items:
        c.execute("INSERT INTO menu (user_id,item,price,category,image) VALUES (?,?,?,?,?)",
                  (user_id, item, price, category, ""))

    conn.commit()
    conn.close()


# ================= LOGIN =================
@app.route('/', methods=['GET', 'POST'])
def login():
    user = None

    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        conn = db()
        c = conn.cursor()
        c.execute("SELECT id FROM users WHERE username=? AND password=?",
                  (username, password))
        user = c.fetchone()
        conn.close()

        if user:
            session['user_id'] = user[0]
            session['username'] = username

            conn = db()
            c = conn.cursor()
            c.execute("SELECT is_admin FROM users WHERE id=?", (user[0],))
            is_admin = c.fetchone()[0]
            conn.close()

            if is_admin == 1:
                return redirect('/superadmin')

            return redirect('/dashboard')

    return render_template('login.html')


# ================= REGISTER =================
@app.route('/register', methods=['GET','POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        whatsapp = request.form['whatsapp']

        conn = db()
        c = conn.cursor()

        c.execute("""
INSERT INTO users (username,password,whatsapp,is_admin)
VALUES (?,?,?,0)
""", (username, password, whatsapp))

        user_id = c.lastrowid

        conn.commit()
        conn.close()

        # AUTO ADD MENU
        seed_menu(user_id)

        return redirect('/')

    return render_template('login.html', register=True)


# ================= QR  =================
@app.route('/qr/<username>')
def generate_qr(username):
    menu_url = f"https://your-app-name.onrender.com/menu/{username}"

    # 🔥 CREATE QR
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=14,
        border=2,
    )
    qr.add_data(menu_url)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color="#000000", back_color="#ffffff").convert('RGB')

    # 🔥 ROUND CORNERS EFFECT
    qr_img = qr_img.resize((500, 500))
    mask = Image.new('L', qr_img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, 500, 500), radius=40, fill=255)
    qr_img.putalpha(mask)

    # 🔥 ADD LOGO
    logo_path = "static/logo.png"
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")

        logo_size = 120
        logo = logo.resize((logo_size, logo_size))

        pos = ((qr_img.size[0] - logo_size)//2, (qr_img.size[1] - logo_size)//2)
        qr_img.paste(logo, pos, mask=logo)

    # 🔥 ADD TEXT (Restaurant Name)
    final_img = Image.new("RGB", (500, 600), "white")
    final_img.paste(qr_img, (0, 0), qr_img)

    draw = ImageDraw.Draw(final_img)

    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except:
        font = ImageFont.load_default()

    text = username.upper()
    text_w, text_h = draw.textbbox((0,0), text, font=font)[2:]

    draw.text(((500 - text_w)//2, 520), text, fill="black", font=font)

    # 🔥 SAVE TO MEMORY
    img_io = io.BytesIO()
    final_img.save(img_io, 'PNG')
    img_io.seek(0)

    return send_file(img_io, mimetype='image/png')
# ================= SUPER ADMIN =================
@app.route('/superadmin')
def superadmin():
    conn = db()
    c = conn.cursor()

    c.execute("""
        SELECT u.id, u.username, u.whatsapp, u.expiry,
        (SELECT COUNT(*) FROM menu WHERE user_id=u.id)
        FROM users u WHERE is_admin=0
    """)

    rows = c.fetchall()
    conn.close()

    users = []
    for r in rows:
        users.append({
            "id": r[0],
            "username": r[1],
            "whatsapp": r[2],
            "expiry": r[3],
            "menu_count": r[4]
        })

    return render_template("superadmin.html", users=users, today=str(date.today()))
# ================= expiry =================
@app.route('/extend/<int:id>')
def extend(id):
    conn = db()
    c = conn.cursor()

    from datetime import datetime, timedelta

    new_date = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')

    c.execute("UPDATE users SET expiry=? WHERE id=?", (new_date, id))

    conn.commit()
    conn.close()

    return redirect('/superadmin')
    
    return redirect('/superadmin')
# ================= delete user =================
@app.route('/delete_user/<int:id>')
def delete_user(id):
    conn = db()
    c = conn.cursor()

    c.execute("DELETE FROM users WHERE id=?", (id,))
    c.execute("DELETE FROM menu WHERE user_id=?", (id,))

    conn.commit()
    conn.close()

    return redirect('/superadmin')
@app.route('/set_expiry/<int:id>', methods=['GET','POST'])
def set_expiry(id):
    if request.method == 'POST':
        expiry = request.form['expiry']

        conn = db()
        c = conn.cursor()
        c.execute("UPDATE users SET expiry=? WHERE id=?", (expiry, id))
        conn.commit()
        conn.close()

        return redirect('/superadmin')

    return f'''
    <form method="POST">
        <h3>Set Expiry Date</h3>
        <input type="date" name="expiry" required>
        <button>Save</button>
    </form>
    '''
# ================= add/edit =================
@app.route('/edit_user/<int:id>', methods=['GET','POST'])
def edit_user(id):
    conn = db()
    c = conn.cursor()

    if request.method == 'POST':
        username = request.form['username']
        whatsapp = request.form['whatsapp']

        c.execute("""
            UPDATE users SET username=?, whatsapp=? WHERE id=?
        """, (username, whatsapp, id))

        conn.commit()
        conn.close()

        return redirect('/superadmin')

    c.execute("SELECT username, whatsapp FROM users WHERE id=?", (id,))
    user = c.fetchone()
    conn.close()

    return f'''
    <form method="POST">
        <h3>Edit User</h3>
        <input name="username" value="{user[0]}"><br>
        <input name="whatsapp" value="{user[1]}"><br>
        <button>Update</button>
    </form>
    '''
# ================= upload excell =================

@app.route('/upload_excel', methods=['POST'])
def upload_excel():
    if 'user_id' not in session:
        return redirect('/')

    file = request.files['file']

    df = pd.read_excel(file)

    conn = db()
    c = conn.cursor()

    for _, row in df.iterrows():
        item = str(row['item'])
        price = str(row['price'])
        category = str(row['category'])

        # جلوگیری duplicate
        c.execute("SELECT * FROM menu WHERE user_id=? AND item=?",
                  (session['user_id'], item))
        if c.fetchone():
            continue

        c.execute("""
            INSERT INTO menu (user_id,item,price,category,image)
            VALUES (?,?,?,?,?)
        """, (session['user_id'], item, price, category, ""))

    conn.commit()
    conn.close()

    return redirect('/dashboard')


# ================= DASHBOARD =================
@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
    if 'user_id' not in session:
        return redirect('/')

    conn = db()
    c = conn.cursor()

    if request.method == 'POST':
        item = request.form['item']
        price = request.form['price']
        category = request.form['category']

        file = request.files.get('image')
        filename = ""

        if file and file.filename != "":
            filename = secure_filename(file.filename)
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

        c.execute("INSERT INTO menu (user_id,item,price,category,image) VALUES (?,?,?,?,?)",
                  (session['user_id'], item, price, category, filename))
        conn.commit()

    c.execute("SELECT id,item,price,category,image FROM menu WHERE user_id=?",
              (session['user_id'],))
    data = c.fetchall()
    conn.close()

    return render_template('dashboard.html', data=data, username=session['username'])
# update_restaurant
@app.route('/update_restaurant', methods=['POST'])
def update_restaurant():
    if 'user_id' not in session:
        return redirect('/')

    address = request.form.get('address')

    file = request.files.get('banner')

    conn = db()
    c = conn.cursor()

    # get old banner
    c.execute("SELECT banner FROM users WHERE id=?", (session['user_id'],))
    old_banner = c.fetchone()[0]

    if file and file.filename != "":
        filename = secure_filename(file.filename)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        banner = filename
    else:
        banner = old_banner  # keep old if not uploading

    c.execute("""
        UPDATE users 
        SET address=?, banner=? 
        WHERE id=?
    """, (address, banner, session['user_id']))

    conn.commit()
    conn.close()

    return redirect('/dashboard')

# ================= DELETE =================
@app.route('/delete/<int:id>')
def delete(id):
    conn = db()
    c = conn.cursor()
    c.execute("DELETE FROM menu WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return redirect('/dashboard')


# ================= EDIT =================
@app.route('/edit/<int:id>', methods=['GET', 'POST'])
def edit(id):
    conn = db()
    c = conn.cursor()

    if request.method == 'POST':
        item = request.form['item']
        price = request.form['price']
        category = request.form['category']

        file = request.files.get('image')

        if file and file.filename != "":
            filename = secure_filename(file.filename)
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

            c.execute("""
                UPDATE menu 
                SET item=?, price=?, category=?, image=? 
                WHERE id=?
            """, (item, price, category, filename, id))
        else:
            c.execute("""
                UPDATE menu 
                SET item=?, price=?, category=? 
                WHERE id=?
            """, (item, price, category, id))

        conn.commit()
        conn.close()
        return redirect('/dashboard')

    c.execute("SELECT item,price,category,image FROM menu WHERE id=?", (id,))
    data = c.fetchone()
    conn.close()

    return render_template('edit.html', data=data, id=id)


# ================= PUBLIC MENU =================
from datetime import date

@app.route('/menu/<username>')
def menu(username):
    conn = db()
    c = conn.cursor()

    c.execute("SELECT id, whatsapp, expiry, address, banner FROM users WHERE username=?", (username,))
    user = c.fetchone()

    if not user:
        return "Not Found"

    user_id = user[0]
    whatsapp = user[1]
    expiry = user[2]
    address = user[3]
    banner = user[4]

    # 🔥 CHECK EXPIRY
    if expiry:
        if expiry < str(date.today()):
           return render_template("expired.html", whatsapp=whatsapp)

    # NORMAL FLOW
    c.execute("SELECT item,price,category,image FROM menu WHERE user_id=?", (user_id,))
    data = c.fetchall()

    c.execute("SELECT DISTINCT category FROM menu WHERE user_id=?", (user_id,))
    categories = [x[0] for x in c.fetchall()]

    conn.close()

    return render_template(
    "menu.html",
    data=data,
    categories=categories,
    username=username,
    whatsapp=whatsapp,
    address=address,
    banner=banner

    )
if __name__ == '__main__':
    app.run(debug=True)