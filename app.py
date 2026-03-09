from flask import Flask, render_template, request, redirect, session
import sqlite3, os
from werkzeug.utils import secure_filename
import pandas as pd
from datetime import date
import qrcode
from flask import send_file
from PIL import Image, ImageDraw, ImageFont
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader



app = Flask(__name__)
app.secret_key = "secret123"

UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
DEFAULT_TABLE_NUMBERS = ",".join(str(i) for i in range(1, 11))


def normalize_table_numbers(raw_value):
    if not raw_value:
        return DEFAULT_TABLE_NUMBERS

    cleaned = []
    for value in raw_value.split(","):
        table_no = value.strip()
        if table_no and table_no not in cleaned:
            cleaned.append(table_no)

    return ",".join(cleaned) if cleaned else DEFAULT_TABLE_NUMBERS


def parse_table_numbers(raw_value):
    return normalize_table_numbers(raw_value).split(",")


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
    banner TEXT,
    table_numbers TEXT DEFAULT '1,2,3,4,5,6,7,8,9,10'
)''')

    c.execute('''CREATE TABLE IF NOT EXISTS menu (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        item TEXT,
        price TEXT,
        category TEXT,
        image TEXT
    )''')

    # Backward-compatible migration for existing databases
    c.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in c.fetchall()]
    if "table_numbers" not in user_columns:
        c.execute("ALTER TABLE users ADD COLUMN table_numbers TEXT")

    c.execute("""
        UPDATE users
        SET table_numbers=?
        WHERE table_numbers IS NULL OR TRIM(table_numbers)=''
    """, (DEFAULT_TABLE_NUMBERS,))

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


# ================= PREMIUM QR =================
# ================= MERGED QR (PREVIEW + PNG + PDF) =================
@app.route('/qr/<username>')
def generate_qr(username):
    import qrcode, io, os
    from flask import request
    from PIL import Image, ImageDraw, ImageFont
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import HexColor
    from reportlab.lib.utils import ImageReader

    menu_url = f"{request.host_url}menu/{username}"

    # -------- QR --------
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=2,
    )
    qr.add_data(menu_url)
    qr.make(fit=True)

    qr_img = qr.make_image(
        fill_color="#D4AF37",
        back_color="#000000"
    ).convert("RGB")

    qr_size = 600
    qr_img = qr_img.resize((qr_size, qr_size))

    # -------- LOGO --------
    logo_path = "static/logo.png"
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")
        logo = logo.resize((140, 140))

        mask = Image.new("L", (140, 140), 0)
        draw_mask = ImageDraw.Draw(mask)
        draw_mask.ellipse((0, 0, 140, 140), fill=255)
        logo.putalpha(mask)

        qr_img.paste(logo, (230, 230), logo)

    # -------- CANVAS (PNG DESIGN) --------
    width, height = 900, 1100
    canvas_img = Image.new("RGB", (width, height), "#000000")
    draw = ImageDraw.Draw(canvas_img)

    gold = "#D4AF37"

    draw.rectangle((20, 20, width-20, height-20), outline=gold, width=4)
    draw.rectangle((50, 50, width-50, height-50), outline=gold, width=1)

    try:
        font_big = ImageFont.truetype("arial.ttf", 60)
        font_small = ImageFont.truetype("arial.ttf", 28)
    except:
        font_big = None
        font_small = None

    draw.text((width//2, 120), "SCAN & ORDER", fill=gold, anchor="mm", font=font_big)

    canvas_img.paste(qr_img, ((width-qr_size)//2, 260))

    draw.text((width//2, 920), "Scan to view menu", fill=gold, anchor="mm", font=font_small)
    draw.text((width//2, 980), f"@{username}", fill=gold, anchor="mm", font=font_small)

    # ================= PNG =================
    if request.args.get("type") == "png":
        img_io = io.BytesIO()
        canvas_img.save(img_io, 'PNG')
        img_io.seek(0)

        return send_file(
            img_io,
            as_attachment=True,
            download_name=f"{username}_qr.png",
            mimetype='image/png'
        )

    # ================= PDF =================
    if request.args.get("type") == "pdf":
        qr_bytes = io.BytesIO()
        qr_img.save(qr_bytes, format="PNG")
        qr_bytes.seek(0)

        qr_reader = ImageReader(qr_bytes)

        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=A4)
        w, h = A4

        gold_color = HexColor("#C9A14A")

        # Background
        c.setFillColor(HexColor("#000000"))
        c.rect(0, 0, w, h, fill=1)

        # Border
        c.setStrokeColor(gold_color)
        c.setLineWidth(3)
        c.rect(30, 30, w-60, h-60)

        # Title
        c.setFillColor(gold_color)
        c.setFont("Helvetica-Bold", 30)
        c.drawCentredString(w/2, h-80, "SCAN & ORDER")

        # QR
        c.drawImage(qr_reader, w/2 - 150, h/2 - 100, width=300, height=300)

        # Text
        c.setFont("Helvetica", 14)
        c.drawCentredString(w/2, h/2 - 150, "Scan to view menu")

        # Username
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(w/2, 60, f"@{username}")

        c.showPage()
        c.save()

        buffer.seek(0)

        return send_file(
            buffer,
            as_attachment=True,
            download_name=f"{username}_qr.pdf",
            mimetype='application/pdf'
        )

    # ================= PREVIEW =================
    img_io = io.BytesIO()
    canvas_img.save(img_io, 'PNG')
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
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Set Expiry</title>
        <style>
            * {{ box-sizing: border-box; }}
            body {{
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 14px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(145deg, #eef2ff, #f8f9ff);
            }}
            .card {{
                width: min(420px, 100%);
                background: #fff;
                border: 1px solid #e2e7f3;
                border-radius: 14px;
                padding: 20px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            }}
            h3 {{ margin-top: 0; margin-bottom: 12px; }}
            input {{
                width: 100%;
                padding: 11px;
                border-radius: 10px;
                border: 1px solid #ccd3e8;
                margin-bottom: 12px;
                font-size: 16px;
            }}
            button {{
                width: 100%;
                border: none;
                border-radius: 10px;
                padding: 11px;
                background: #667eea;
                color: #fff;
                font-weight: 600;
                cursor: pointer;
            }}
            button:hover {{ background: #5366d7; }}
        </style>
    </head>
    <body>
        <form class="card" method="POST">
            <h3>Set Expiry Date</h3>
            <input type="date" name="expiry" required>
            <button>Save</button>
        </form>
    </body>
    </html>
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
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Edit User</title>
        <style>
            * {{ box-sizing: border-box; }}
            body {{
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 14px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(145deg, #eef2ff, #f8f9ff);
            }}
            .card {{
                width: min(420px, 100%);
                background: #fff;
                border: 1px solid #e2e7f3;
                border-radius: 14px;
                padding: 20px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            }}
            h3 {{ margin-top: 0; margin-bottom: 12px; }}
            input {{
                width: 100%;
                padding: 11px;
                border-radius: 10px;
                border: 1px solid #ccd3e8;
                margin-bottom: 12px;
                font-size: 16px;
            }}
            button {{
                width: 100%;
                border: none;
                border-radius: 10px;
                padding: 11px;
                background: #667eea;
                color: #fff;
                font-weight: 600;
                cursor: pointer;
            }}
            button:hover {{ background: #5366d7; }}
        </style>
    </head>
    <body>
        <form class="card" method="POST">
            <h3>Edit User</h3>
            <input name="username" value="{user[0]}" required>
            <input name="whatsapp" value="{user[1]}" required>
            <button>Update</button>
        </form>
    </body>
    </html>
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

    # Handle Add Menu Item POST request
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

    # Fetch menu items for this user
    c.execute("SELECT id,item,price,category,image FROM menu WHERE user_id=?", (session['user_id'],))
    data = c.fetchall()

    # 🔥 NEW: Fetch user's current address to pre-fill the Restaurant Settings form
    c.execute("SELECT address, table_numbers FROM users WHERE id=?", (session['user_id'],))
    user_row = c.fetchone()
    # Safely handle if the address is None
    address = user_row[0] if user_row and user_row[0] else ""
    table_numbers = normalize_table_numbers(user_row[1] if user_row and len(user_row) > 1 else "")

    conn.close()

    # Pass the settings variables to the template
    return render_template(
        'dashboard.html',
        data=data,
        username=session['username'],
        address=address,
        table_numbers=table_numbers
    )
# update_restaurant
@app.route('/update_restaurant', methods=['POST'])
def update_restaurant():
    if 'user_id' not in session:
        return redirect('/')

    address = request.form.get('address')
    table_numbers = normalize_table_numbers(request.form.get('table_numbers'))

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
        SET address=?, banner=?, table_numbers=? 
        WHERE id=?
    """, (address, banner, table_numbers, session['user_id']))

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

    c.execute("SELECT id, whatsapp, expiry, address, banner, table_numbers FROM users WHERE username=?", (username,))
    user = c.fetchone()

    if not user:
        return "Not Found"

    user_id = user[0]
    whatsapp = user[1]
    expiry = user[2]
    address = user[3]
    banner = user[4]
    table_numbers = parse_table_numbers(user[5] if len(user) > 5 else "")

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
    banner=banner,
    table_numbers=table_numbers

    )
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))