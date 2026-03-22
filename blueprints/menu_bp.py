from flask import Blueprint, render_template, request, redirect, session, send_file, abort, flash
from models import db, User, Menu, Order, OrderItem
from functools import wraps
from datetime import date
from config import Config
from pricing import normalize_price
from uploads import save_uploaded_image
import os
import io
import pandas as pd
import qrcode
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader

menu_bp = Blueprint('menu', __name__)
ALLOWED_THEME_PRESETS = {'default', 'modern', 'playful'}


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect('/')
        return f(*args, **kwargs)
    return decorated


def normalize_table_numbers(raw_value):
    default = Config.DEFAULT_TABLE_NUMBERS
    if not raw_value:
        return default

    cleaned = []
    for value in raw_value.split(","):
        table_no = value.strip()
        if table_no and table_no not in cleaned:
            cleaned.append(table_no)

    return ",".join(cleaned) if cleaned else default


def parse_table_numbers(raw_value):
    return normalize_table_numbers(raw_value).split(",")


def normalize_theme_preset(raw_value):
    preset = (raw_value or 'default').strip().lower()
    return preset if preset in ALLOWED_THEME_PRESETS else 'default'


def parse_optional_non_negative_int(raw_value, field_name):
    value = (raw_value or '').strip()
    if not value:
        return None

    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a whole number.") from exc

    if parsed < 0:
        raise ValueError(f"{field_name} cannot be negative.")

    return parsed


def resolve_inventory_values(stock_raw, daily_limit_raw):
    stock_value = parse_optional_non_negative_int(stock_raw, "Current stock")
    daily_limit_value = parse_optional_non_negative_int(daily_limit_raw, "Daily auto-reset limit")

    if stock_value is None and daily_limit_value is None:
        return -1, -1

    if stock_value is None and daily_limit_value is not None:
        return daily_limit_value, daily_limit_value

    return stock_value if stock_value is not None else -1, daily_limit_value if daily_limit_value is not None else -1


def sync_availability_with_stock(menu_item, previous_stock=None):
    if menu_item.stock == 0:
        menu_item.available = 0
    elif previous_stock == 0 and menu_item.stock != 0:
        menu_item.available = 1


def serialize_menu_item(menu_item):
    return {
        "id": menu_item.id,
        "item": menu_item.item,
        "price": menu_item.price,
        "category": menu_item.category or "",
        "image": menu_item.image or "",
        "stock": menu_item.stock,
        "available": menu_item.available,
    }


def auto_reset_stock(user_id):
    """
    Checks all menu items for the user. If an item has a daily_limit > 0
    and hasn't been reset today, sets its stock back to the daily_limit
    and updates last_reset_date.
    """
    today_str = date.today().strftime('%Y-%m-%d')
    items = Menu.query.filter_by(user_id=user_id).all()
    updated = False
    for item in items:
        if item.daily_limit is None or item.daily_limit <= 0:
            continue
        if item.last_reset_date == today_str:
            continue

        item.stock = item.daily_limit
        item.last_reset_date = today_str
        if item.stock != 0:
            item.available = 1
        updated = True
    if updated:
        db.session.commit()


# ================= INVENTORY =================
@menu_bp.route('/inventory', methods=['GET', 'POST'])
@login_required
def inventory():
    if request.method == 'POST':
        try:
            item = request.form['item'].strip()
            category = request.form['category'].strip()
            if not item:
                raise ValueError("Item name is required.")
            if not category:
                raise ValueError("Category is required.")

            price = normalize_price(request.form['price'])
            stock, daily_limit = resolve_inventory_values(
                request.form.get('stock'),
                request.form.get('daily_limit'),
            )

            file = request.files.get('image')
            filename = ""
            if file and file.filename != "":
                filename = save_uploaded_image(file)
        except ValueError as exc:
            flash(str(exc), 'error')
            return redirect('/inventory')

        today_str = date.today().strftime('%Y-%m-%d')
        db.session.add(Menu(
            user_id=session['user_id'], item=item, price=price,
            category=category, image=filename, stock=stock,
            available=0 if stock == 0 else 1,
            daily_limit=daily_limit,
            last_reset_date=today_str if daily_limit > 0 else None
        ))
        db.session.commit()

    # Reset stock if a new day has started
    auto_reset_stock(session['user_id'])

    data = Menu.query.filter_by(user_id=session['user_id']).all()
    data_tuples = [(m.id, m.item, m.price, m.category, m.image, m.available, m.stock, m.daily_limit) for m in data]

    return render_template('inventory.html', data=data_tuples,
                           username=session['username'])


# ================= DASHBOARD =================
@menu_bp.route('/dashboard')
@login_required
def dashboard():
    # If not embedded, serve the software wrapper layout
    if not request.args.get('embedded'):
        return render_template('software_layout.html')

    data = Menu.query.filter_by(user_id=session['user_id']).all()
    user = db.session.get(User, session['user_id'])
    address = user.address or ""
    table_numbers = normalize_table_numbers(user.table_numbers)

    # Convert to tuples for template compatibility
    data_tuples = [(m.id, m.item, m.price, m.category, m.image, m.available) for m in data]

    # Order stats
    today = date.today()
    today_orders = Order.query.filter(
        Order.user_id == session['user_id'],
        Order.status != 'cancelled',
        db.func.date(Order.created_at) == today
    ).all()
    orders_today = len(today_orders)
    revenue_today = sum(o.total for o in today_orders)

    return render_template('dashboard.html', data=data_tuples,
                           username=session['username'],
                           address=address, table_numbers=table_numbers,
                           slogan=user.slogan,
                           theme_preset=normalize_theme_preset(user.theme_preset),
                           banner=user.banner, logo=user.logo,
                           upi_qr=user.upi_qr,
                           orders_today=orders_today,
                           revenue_today=revenue_today)


# ================= UPDATE RESTAURANT =================
@menu_bp.route('/update_restaurant', methods=['POST'])
@login_required
def update_restaurant():
    user = db.session.get(User, session['user_id'])
    if not user:
        return redirect('/')

    user.address = (request.form.get('address') or '').strip()
    user.slogan = request.form.get('slogan', '')
    user.theme_preset = normalize_theme_preset(request.form.get('theme_preset'))
    user.table_numbers = normalize_table_numbers(request.form.get('table_numbers'))

    try:
        file = request.files.get('banner')
        if file and file.filename != "":
            user.banner = save_uploaded_image(file)

        logo_file = request.files.get('logo')
        if logo_file and logo_file.filename != "":
            user.logo = save_uploaded_image(logo_file)

        upi_file = request.files.get('upi_qr')
        if upi_file and upi_file.filename != "":
            user.upi_qr = save_uploaded_image(upi_file)
    except ValueError as exc:
        flash(str(exc), 'error')
        return redirect('/dashboard')

    db.session.commit()
    return redirect('/dashboard')


# ================= UPLOAD EXCEL =================
@menu_bp.route('/upload_excel', methods=['POST'])
@login_required
def upload_excel():
    file = request.files.get('file')
    if not file or not file.filename:
        flash('Please choose an Excel file first.', 'error')
        return redirect('/inventory')

    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        flash('Only .xlsx and .xls files are supported.', 'error')
        return redirect('/inventory')

    try:
        df = pd.read_excel(file)
    except Exception:
        flash('Unable to read the Excel file.', 'error')
        return redirect('/inventory')

    required_columns = {'item', 'price', 'category'}
    normalized_columns = {str(col).strip().lower(): col for col in df.columns}
    if not required_columns.issubset(normalized_columns):
        flash('Excel must contain item, price, and category columns.', 'error')
        return redirect('/inventory')

    for _, row in df.iterrows():
        item = str(row[normalized_columns['item']]).strip()
        category = str(row[normalized_columns['category']]).strip()

        if not item or item.lower() == 'nan' or not category or category.lower() == 'nan':
            continue

        try:
            price = normalize_price(row[normalized_columns['price']])
        except ValueError:
            continue

        existing = Menu.query.filter_by(
            user_id=session['user_id'], item=item).first()
        if existing:
            continue

        db.session.add(Menu(user_id=session['user_id'], item=item,
                            price=price, category=category, image=""))

    db.session.commit()
    return redirect('/inventory')


# ================= DELETE =================
@menu_bp.route('/delete/<int:id>', methods=['POST'])
@login_required
def delete(id):
    item = Menu.query.get_or_404(id)
    if item.user_id != session['user_id']:
        abort(403)
    db.session.delete(item)
    db.session.commit()
    return redirect('/inventory')


# ================= TOGGLE AVAILABILITY =================
@menu_bp.route('/toggle_available/<int:id>', methods=['POST'])
@login_required
def toggle_available(id):
    item = Menu.query.get_or_404(id)
    if item.user_id != session['user_id']:
        abort(403)

    if item.available:
        item.available = 0
    else:
        if item.stock == 0 and item.daily_limit and item.daily_limit > 0:
            item.stock = item.daily_limit
        elif item.stock == 0:
            flash('Set stock above 0 before marking the item as available.', 'error')
            return redirect('/inventory')

        item.available = 1

    db.session.commit()
    return redirect('/inventory')


# ================= UPDATE STOCK =================
@menu_bp.route('/update_stock/<int:id>', methods=['POST'])
@login_required
def update_stock(id):
    item = Menu.query.get_or_404(id)
    if item.user_id != session['user_id']:
        abort(403)

    stock = request.form.get('stock', '').strip()
    try:
        previous_stock = item.stock
        item.stock = parse_optional_non_negative_int(stock, "Current stock")
        item.stock = item.stock if item.stock is not None else -1
        sync_availability_with_stock(item, previous_stock)
    except ValueError as exc:
        flash(str(exc), 'error')
        return redirect('/inventory')

    db.session.commit()
    return redirect('/inventory')


# ================= EDIT =================
@menu_bp.route('/edit/<int:id>', methods=['GET', 'POST'])
@login_required
def edit(id):
    item = Menu.query.get_or_404(id)
    if item.user_id != session['user_id']:
        abort(403)

    if request.method == 'POST':
        try:
            item_name = request.form['item'].strip()
            category = request.form['category'].strip()
            if not item_name:
                raise ValueError("Item name is required.")
            if not category:
                raise ValueError("Category is required.")

            previous_stock = item.stock
            stock, daily_limit = resolve_inventory_values(
                request.form.get('stock'),
                request.form.get('daily_limit'),
            )

            item.item = item_name
            item.price = normalize_price(request.form['price'])
            item.category = category
            item.stock = stock
            item.daily_limit = daily_limit
            item.last_reset_date = date.today().strftime('%Y-%m-%d') if daily_limit > 0 else None
            sync_availability_with_stock(item, previous_stock)

            file = request.files.get('image')
            if file and file.filename != "":
                item.image = save_uploaded_image(file)
        except ValueError as exc:
            flash(str(exc), 'error')
            return redirect(f'/edit/{id}')

        db.session.commit()
        return redirect('/inventory')

    data = (item.item, item.price, item.category, item.image, item.stock, item.daily_limit)
    return render_template('edit.html', data=data, id=id)


# ================= PUBLIC MENU =================
@menu_bp.route('/menu/<username>')
def menu(username):
    user = User.query.filter_by(username=username.upper()).first()

    if not user:
        return "Not Found", 404

    # Check expiry
    if user.expiry:
        if user.expiry < str(date.today()):
            return render_template("expired.html", whatsapp=user.whatsapp)

    # Auto-reset stock if a new day has started
    auto_reset_stock(user.id)

    items = Menu.query.filter_by(user_id=user.id).order_by(Menu.category, Menu.item).all()
    data = [serialize_menu_item(menu_item) for menu_item in items]

    categories = [category for category in dict.fromkeys(m.category for m in items if m.category)]

    table_numbers = parse_table_numbers(user.table_numbers)

    return render_template(
        "menu.html",
        data=data,
        categories=categories,
        username=username,
        whatsapp=user.whatsapp,
        address=user.address or "",
        slogan=user.slogan or "",
        theme_preset=normalize_theme_preset(user.theme_preset),
        banner=user.banner,
        logo=user.logo,
        table_numbers=table_numbers
    )


# ================= CAPTAIN APP =================
@menu_bp.route('/captain')
def captain_login():
    return render_template("captain_login.html")

@menu_bp.route('/captain/<username>')
def captain(username):
    user = User.query.filter_by(username=username.upper()).first()

    if not user:
        return "Not Found", 404

    # Check expiry
    if user.expiry:
        if user.expiry < str(date.today()):
            return render_template("expired.html", whatsapp=user.whatsapp)

    # Auto-reset stock if a new day has started
    auto_reset_stock(user.id)

    items = Menu.query.filter_by(user_id=user.id).order_by(Menu.category, Menu.item).all()
    data = [serialize_menu_item(menu_item) for menu_item in items]

    categories = [category for category in dict.fromkeys(m.category for m in items if m.category)]

    table_numbers = parse_table_numbers(user.table_numbers)

    return render_template(
        "captain.html",
        data=data,
        categories=categories,
        username=user.username,
        theme_preset=normalize_theme_preset(user.theme_preset),
        logo=user.logo,
        table_numbers=table_numbers
    )


# ================= QR CODE =================
@menu_bp.route('/qr/<username>')
def generate_qr(username):
    menu_url = f"{request.host_url}menu/{username}"

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

    # Logo
    user = User.query.filter_by(username=username.upper()).first()
    if user and user.logo:
        logo_path = os.path.join(Config.UPLOAD_FOLDER, user.logo)
    else:
        logo_path = "static/logo.png"
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")
        logo = logo.resize((140, 140))

        mask = Image.new("L", (140, 140), 0)
        draw_mask = ImageDraw.Draw(mask)
        draw_mask.ellipse((0, 0, 140, 140), fill=255)
        logo.putalpha(mask)

        qr_img.paste(logo, (230, 230), logo)

    # Canvas
    width, height = 900, 1100
    canvas_img = Image.new("RGB", (width, height), "#000000")
    draw = ImageDraw.Draw(canvas_img)

    gold = "#D4AF37"
    draw.rectangle((20, 20, width - 20, height - 20), outline=gold, width=4)
    draw.rectangle((50, 50, width - 50, height - 50), outline=gold, width=1)

    try:
        font_big = ImageFont.truetype("arial.ttf", 60)
        font_small = ImageFont.truetype("arial.ttf", 28)
    except:
        font_big = None
        font_small = None

    draw.text((width // 2, 120), "SCAN & ORDER", fill=gold, anchor="mm", font=font_big)
    canvas_img.paste(qr_img, ((width - qr_size) // 2, 260))
    draw.text((width // 2, 920), "Scan to view menu", fill=gold, anchor="mm", font=font_small)
    draw.text((width // 2, 980), f"@{username}", fill=gold, anchor="mm", font=font_small)

    # PNG
    if request.args.get("type") == "png":
        img_io = io.BytesIO()
        canvas_img.save(img_io, 'PNG')
        img_io.seek(0)
        return send_file(img_io, as_attachment=True,
                         download_name=f"{username}_qr.png",
                         mimetype='image/png')

    # PDF
    if request.args.get("type") == "pdf":
        qr_bytes = io.BytesIO()
        qr_img.save(qr_bytes, format="PNG")
        qr_bytes.seek(0)
        qr_reader = ImageReader(qr_bytes)

        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=A4)
        w, h = A4

        gold_color = HexColor("#C9A14A")

        c.setFillColor(HexColor("#000000"))
        c.rect(0, 0, w, h, fill=1)

        c.setStrokeColor(gold_color)
        c.setLineWidth(3)
        c.rect(30, 30, w - 60, h - 60)

        c.setFillColor(gold_color)
        c.setFont("Helvetica-Bold", 30)
        c.drawCentredString(w / 2, h - 80, "SCAN & ORDER")

        c.drawImage(qr_reader, w / 2 - 150, h / 2 - 100, width=300, height=300)

        c.setFont("Helvetica", 14)
        c.drawCentredString(w / 2, h / 2 - 150, "Scan to view menu")

        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(w / 2, 60, f"@{username}")

        c.showPage()
        c.save()
        buffer.seek(0)

        return send_file(buffer, as_attachment=True,
                         download_name=f"{username}_qr.pdf",
                         mimetype='application/pdf')

    # Preview
    img_io = io.BytesIO()
    canvas_img.save(img_io, 'PNG')
    img_io.seek(0)
    return send_file(img_io, mimetype='image/png')


# ================= ORDER HISTORY =================
@menu_bp.route('/orders')
@login_required
def order_history():
    month = request.args.get('month', type=int)
    year = request.args.get('year', type=int)

    query = Order.query.filter(Order.user_id == session['user_id'], Order.status != 'cancelled')

    if year:
        query = query.filter(db.extract('year', Order.created_at) == year)
    if month:
        query = query.filter(db.extract('month', Order.created_at) == month)

    orders = query.order_by(Order.created_at.desc()).all()

    total_revenue = sum(o.total for o in orders)
    total_orders = len(orders)

    return render_template('order_history.html',
                           orders=orders,
                           username=session['username'],
                           total_revenue=total_revenue,
                           total_orders=total_orders,
                           filter_month=month,
                           filter_year=year)


# ================= BILLING =================
@menu_bp.route('/billing')
@login_required
def billing():
    from datetime import datetime
    from collections import defaultdict

    today = datetime.now().date()

    # Get today's non-settled/cancelled orders for this user
    orders = Order.query.filter(
        Order.user_id == session['user_id'],
        Order.status.notin_(['settled', 'cancelled']),
        db.func.date(Order.created_at) == today
    ).order_by(Order.table_no, Order.created_at).all()

    # Aggregate by table number
    table_map = defaultdict(lambda: {'orders': [], 'items_map': {}, 'total': 0})
    for o in orders:
        t = table_map[o.table_no]
        t['orders'].append(o)
        t['total'] += o.total
        for oi in o.order_items:
            key = oi.item_name
            if key in t['items_map']:
                t['items_map'][key]['qty'] += oi.quantity
                t['items_map'][key]['subtotal'] += oi.price * oi.quantity
            else:
                t['items_map'][key] = {
                    'name': oi.item_name,
                    'qty': oi.quantity,
                    'price': oi.price,
                    'subtotal': oi.price * oi.quantity
                }

    # Build template data
    tables = []
    for tno, data in sorted(table_map.items(), key=lambda x: x[0]):
        tables.append({
            'table_no': tno,
            'orders': data['orders'],
            'line_items': list(data['items_map'].values()),
            'total': data['total']
        })

    grand_total = sum(t['total'] for t in tables)
    total_orders = len(orders)

    user = db.session.get(User, session['user_id'])

    return render_template('billing.html',
                           username=session['username'],
                           tables=tables,
                           grand_total=grand_total,
                           total_orders=total_orders,
                           today=today.strftime('%d %b %Y'),
                           logo=user.logo,
                           address=user.address or '',
                           upi_qr=user.upi_qr)
