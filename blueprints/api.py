from flask import Blueprint, request, jsonify, session
from models import db, User, Menu, Order, OrderItem
from datetime import datetime
from decimal import Decimal
from sqlalchemy.orm import selectinload
import urllib.parse

from extensions import socketio
from pricing import parse_price

api_bp = Blueprint('api', __name__)
ALLOWED_ORDER_STATUSES = {'pending', 'preparing', 'done', 'cancelled', 'settled'}


def _parse_quantity(value):
    try:
        quantity = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Quantity must be a whole number.") from exc

    if quantity <= 0:
        raise ValueError("Quantity must be greater than zero.")

    return quantity


def _parse_allowed_tables(raw_value):
    values = []
    for table_no in (raw_value or '').split(','):
        cleaned = table_no.strip()
        if cleaned and cleaned not in values:
            values.append(cleaned)
    return set(values)


def _load_order_menu_items(user, raw_items):
    if not isinstance(raw_items, list) or not raw_items:
        raise ValueError("At least one item is required.")

    requested_quantities = {}
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise ValueError("Invalid item payload.")

        menu_id = raw_item.get('id')
        item_name = raw_item.get('name', '').strip()
        quantity = _parse_quantity(raw_item.get('qty', 1))

        menu_item = None
        if menu_id is not None:
            try:
                menu_id = int(menu_id)
            except (TypeError, ValueError) as exc:
                raise ValueError("Item id is invalid.") from exc
            menu_item = Menu.query.filter_by(id=menu_id, user_id=user.id).first()
        elif item_name:
            menu_item = Menu.query.filter_by(user_id=user.id, item=item_name).first()

        if not menu_item:
            raise ValueError("One or more menu items are no longer available.")

        requested_quantities[menu_item.id] = requested_quantities.get(menu_item.id, 0) + quantity

    ordered_items = []
    for menu_id, quantity in requested_quantities.items():
        menu_item = Menu.query.get(menu_id)
        if not menu_item:
            raise ValueError("One or more menu items are no longer available.")
        ordered_items.append((menu_item, quantity))

    return ordered_items


# ================= PLACE ORDER =================
@api_bp.route('/api/order', methods=['POST'])
def place_order():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    username = str(data.get('username', '')).strip().upper()
    table = str(data.get('table', '')).strip()
    items = data.get('items', [])
    notes = data.get('notes', '').strip()

    if not username or not table or not items:
        return jsonify({"error": "Missing fields"}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    allowed_tables = _parse_allowed_tables(user.table_numbers)
    if allowed_tables and table not in allowed_tables:
        return jsonify({"error": "Invalid table number"}), 400

    try:
        order_items = _load_order_menu_items(user, items)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    total = Decimal("0.00")

    order = Order(
        user_id=user.id,
        table_no=table,
        notes=notes,
        total=0,
        status='pending',
        created_at=datetime.now()
    )
    db.session.add(order)
    db.session.flush()

    for menu_item, qty in order_items:
        if menu_item.available == 0:
            db.session.rollback()
            return jsonify({"error": f"{menu_item.item} is currently unavailable"}), 400

        if menu_item.stock != -1:
            if menu_item.stock < qty:
                db.session.rollback()
                return jsonify({"error": f"Only {menu_item.stock} left for {menu_item.item}"}), 400
            menu_item.stock -= qty
            if menu_item.stock == 0:
                menu_item.available = 0

        item_price = parse_price(menu_item.price)
        total += item_price * qty

        order_item = OrderItem(
            order_id=order.id,
            item_name=menu_item.item,
            price=float(item_price),
            quantity=qty
        )
        db.session.add(order_item)

    order.total = float(total)
    db.session.commit()

    socketio.emit('new_order', {'order_id': order.id, 'table': table}, room=username)

    return jsonify({"success": True, "order_id": order.id}), 201


# ================= KITCHEN ORDERS =================
@api_bp.route('/kitchen_orders/<username>')
def kitchen_orders(username):
    user = User.query.filter_by(username=username.upper()).first()
    if not user:
        return jsonify({"orders": []}), 404

    orders = Order.query.filter(
        Order.user_id == user.id,
        Order.status.notin_(['done', 'cancelled', 'settled'])
    ).options(selectinload(Order.order_items)).order_by(Order.created_at.desc()).all()

    result = []
    for o in orders:
        items = [{"name": oi.item_name, "qty": oi.quantity,
                  "price": oi.price} for oi in o.order_items]
        result.append({
            "id": o.id,
            "table": o.table_no,
            "status": o.status,
            "total": o.total,
            "notes": o.notes or '',
            "created_at": o.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            "items": items
        })

    return jsonify({"orders": result})


# ================= TABLE STATUS =================
@api_bp.route('/api/table_status/<username>')
def table_status(username):
    user = User.query.filter_by(username=username.upper()).first()
    if not user:
        return jsonify({"tables": {}}), 404

    active_orders = Order.query.filter(
        Order.user_id == user.id,
        Order.status.notin_(['settled', 'cancelled'])
    ).options(selectinload(Order.order_items)).all()

    occupied_tables = {}
    for o in active_orders:
        t_no = str(o.table_no)
        if t_no not in occupied_tables:
            occupied_tables[t_no] = {
                "status": "occupied",
                "table_no": t_no,
                "total": 0.0,
                "item_count": 0,
                "items": [],
                "order_ids": [],
                "created_at": o.created_at.strftime('%I:%M %p')
            }

        occupied_tables[t_no]["total"] += float(o.total or 0)
        occupied_tables[t_no]["order_ids"].append(o.id)

        for oi in o.order_items:
            occupied_tables[t_no]["item_count"] += oi.quantity
            found = False
            for existing in occupied_tables[t_no]["items"]:
                if existing["name"] == oi.item_name:
                    existing["qty"] += oi.quantity
                    existing["subtotal"] += (oi.price * oi.quantity)
                    found = True
                    break
            if not found:
                occupied_tables[t_no]["items"].append({
                    "name": oi.item_name,
                    "qty": oi.quantity,
                    "price": oi.price,
                    "subtotal": oi.price * oi.quantity
                })

    return jsonify({"tables": occupied_tables})



# ================= UPDATE ORDER STATUS =================
@api_bp.route('/update_order/<int:id>', methods=['POST'])
def update_order(id):
    order = Order.query.get_or_404(id)
    data = request.get_json(silent=True) or {}
    status = str(data.get('status', '')).strip().lower()

    if not status:
        return jsonify({"error": "No status"}), 400

    if status not in ALLOWED_ORDER_STATUSES:
        return jsonify({"error": "Invalid status"}), 400

    order.status = status
    db.session.commit()
    
    user = User.query.get(order.user_id)
    if user:
        socketio.emit('order_updated', {'order_id': order.id, 'status': status, 'table': order.table_no}, room=user.username)
        
    return jsonify({"success": True})


# ================= SETTLE TABLE =================
@api_bp.route('/api/settle', methods=['POST'])
def settle_table():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401

    data = request.get_json()
    if not data or 'table' not in data:
        return jsonify({"error": "Missing table number"}), 400
        
    table_no = str(data['table'])
    
    orders = Order.query.filter(
        Order.user_id == user_id,
        Order.table_no == table_no,
        Order.status.notin_(['settled', 'cancelled'])
    ).all()

    for order in orders:
        order.status = 'settled'
    db.session.commit()

    user = User.query.get(user_id)
    if user:
        socketio.emit('table_settled', {'table_no': table_no}, room=user.username)
        
    return jsonify({"success": True, "settled": len(orders)})


# ================= FETCH TABLE BILL (FOR POS PRINTING) =================
@api_bp.route('/api/table_bill/<username>/<table_no>')
def table_bill(username, table_no):
    user = User.query.filter_by(username=username.upper()).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    orders = Order.query.filter(
        Order.user_id == user.id,
        Order.table_no == table_no,
        Order.status.notin_(['settled', 'cancelled'])
    ).all()

    if not orders:
        return jsonify({"error": "No active orders for this table."}), 404

    items_map = {}
    total = 0

    for o in orders:
        for oi in o.order_items:
            key = oi.item_name
            if key in items_map:
                items_map[key]['qty'] += oi.quantity
                items_map[key]['subtotal'] += (oi.price * oi.quantity)
            else:
                items_map[key] = {
                    'name': oi.item_name,
                    'qty': oi.quantity,
                    'price': oi.price,
                    'subtotal': oi.price * oi.quantity
                }
            total += (oi.price * oi.quantity)

    # Convert to list
    line_items = list(items_map.values())

    return jsonify({
        "restaurant_name": username.upper(),
        "address": user.address or "",
        "table_no": table_no,
        "date": orders[-1].created_at.strftime("%Y-%m-%d %H:%M"),
        "items": line_items,
        "total": total
    })


# ================= KITCHEN PAGE =================
@api_bp.route('/kitchen/<username>')
def kitchen(username):
    from flask import render_template
    user = User.query.filter_by(username=username.upper()).first()
    if not user:
        return "Not Found", 404
    return render_template('Kitchen.html', username=user.username)


# ================= PRINT BILL =================
@api_bp.route('/api/print_bill', methods=['POST'])
def print_bill():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400
    
    username = data.get('username', '').strip().upper()
    table_no = data.get('table', '').strip()
    pay_method = data.get('pay_method', 'cash')
    
    if not username or not table_no:
        return jsonify({"error": "Missing fields"}), 400
    
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    orders = Order.query.filter(
        Order.user_id == user.id,
        Order.table_no == table_no,
        Order.status.notin_(['settled', 'cancelled'])
    ).all()
    
    if not orders:
        return jsonify({"error": "No active orders for this table"}), 404
    
    items_map = {}
    total = 0
    
    for o in orders:
        for oi in o.order_items:
            key = oi.item_name
            if key in items_map:
                items_map[key]['qty'] += oi.quantity
                items_map[key]['subtotal'] += (oi.price * oi.quantity)
            else:
                items_map[key] = {
                    'name': oi.item_name,
                    'qty': oi.quantity,
                    'price': oi.price,
                    'subtotal': oi.price * oi.quantity
                }
            total += (oi.price * oi.quantity)
    
    import random
    import datetime
    bill_no = random.randint(100, 999)
    now = datetime.datetime.now()
    date_str = now.strftime("%d-%b-%Y")
    time_str = now.strftime("%I:%M %p")
    
    lines = []
    lines.append(f"{'='*32}")
    lines.append(f"** {user.username.upper()} **")
    if user.address:
        lines.append(f"{user.address[:32]}")
    lines.append(f"{'='*32}")
    lines.append(f"Bill No : {bill_no}")
    lines.append(f"Date    : {date_str}")
    lines.append(f"Table   : {table_no}")
    lines.append(f"Time    : {time_str}")
    lines.append(f"{'-'*32}")
    lines.append(f"{'Item':<18} {'Qty':>4} {'Amt':>8}")
    lines.append(f"{'-'*32}")
    
    for item in items_map.values():
        name = item['name'][:16]
        qty = item['qty']
        amt = f"{item['subtotal']:.2f}"
        lines.append(f"{name:<18} {qty:>4} {amt:>8}")
    
    lines.append(f"{'-'*32}")
    lines.append(f"{'TOTAL':.<24} Rs.{total:.2f}")
    lines.append(f"{'='*32}")
    lines.append(f"Payment : {pay_method.upper()}")
    lines.append(f"{'='*32}")
    lines.append(f"  Thank you! Visit again!  ")
    lines.append("")
    lines.append("")
    
    return jsonify({
        "success": True,
        "bill_text": "\n".join(lines),
        "items": list(items_map.values()),
        "total": total,
        "bill_no": bill_no,
        "date": date_str,
        "time": time_str
    })


# ================= SEND WHATSAPP BILL =================
@api_bp.route('/api/send_whatsapp', methods=['POST'])
def send_whatsapp():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400
    
    username = data.get('username', '').strip().upper()
    table_no = data.get('table', '').strip()
    phone = data.get('phone', '').strip()
    
    if not username or not table_no or not phone:
        return jsonify({"error": "Missing fields"}), 400
    
    import re
    phone = re.sub(r'[^0-9]', '', phone)
    if len(phone) == 10:
        phone = "91" + phone
    
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    orders = Order.query.filter(
        Order.user_id == user.id,
        Order.table_no == table_no,
        Order.status.notin_(['settled', 'cancelled'])
    ).all()
    
    if not orders:
        return jsonify({"error": "No active orders for this table"}), 404
    
    import random
    import datetime
    bill_no = random.randint(100, 999)
    now = datetime.datetime.now()
    date_str = now.strftime("%d-%b-%Y")
    time_str = now.strftime("%I:%M %p")
    
    items_map = {}
    total = 0
    
    for o in orders:
        for oi in o.order_items:
            key = oi.item_name
            if key in items_map:
                items_map[key]['qty'] += oi.quantity
                items_map[key]['subtotal'] += (oi.price * oi.quantity)
            else:
                items_map[key] = {
                    'name': oi.item_name,
                    'qty': oi.quantity,
                    'price': oi.price,
                    'subtotal': oi.price * oi.quantity
                }
            total += (oi.price * oi.quantity)
    
    items_text = "\n".join([
        f"- {item['qty']}x {item['name']}: Rs.{item['subtotal']:.2f}"
        for item in items_map.values()
    ])
    
    message = f"*INVOICE - {user.username.upper()}*\n"
    message += f"Bill No: {bill_no}\n"
    message += f"Table: {table_no}\n"
    message += f"Date: {date_str}, {time_str}\n\n"
    message += f"*ITEMS:*\n{items_text}\n\n"
    message += f"*TOTAL: Rs.{total:.2f}*\n\n"
    if user.address:
        message += f"Address: {user.address}\n"
    message += "Thank you for dining with us!"
    
    wa_url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"
    
    return jsonify({
        "success": True,
        "whatsapp_url": wa_url,
        "message": message
    })


# ================= PRINT KOT =================
@api_bp.route('/api/print_kot', methods=['POST'])
def print_kot():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    username = data.get('username', '').strip().upper()
    table_no = data.get('table', '').strip()

    if not username or not table_no:
        return jsonify({"error": "Missing fields"}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    orders = Order.query.filter(
        Order.user_id == user.id,
        Order.table_no == table_no,
        Order.status.notin_(['settled', 'cancelled'])
    ).all()

    if not orders:
        return jsonify({"error": "No active orders for this table"}), 404

    import random
    import datetime
    kot_no = random.randint(100, 999)
    now = datetime.datetime.now()
    date_str = now.strftime("%d-%b-%Y")
    time_str = now.strftime("%I:%M %p")

    items_map = {}
    notes_list = []

    for o in orders:
        if o.notes:
            notes_list.append(o.notes)
        for oi in o.order_items:
            key = oi.item_name
            if key in items_map:
                items_map[key]['qty'] += oi.quantity
            else:
                items_map[key] = {
                    'name': oi.item_name,
                    'qty': oi.quantity
                }

    lines = []
    lines.append(f"{'='*32}")
    lines.append(f"** KITCHEN ORDER TICKET **")
    lines.append(f"{'='*32}")
    lines.append(f"KOT No  : #{kot_no}")
    lines.append(f"Table   : TABLE {table_no}")
    lines.append(f"Time    : {date_str} {time_str}")
    lines.append(f"{'-'*32}")
    lines.append(f"{'Item':<24} {'Qty':>6}")
    lines.append(f"{'-'*32}")

    for item in items_map.values():
        name = item['name'][:22]
        qty = item['qty']
        lines.append(f"{name:<24} {qty:>6}")

    lines.append(f"{'-'*32}")
    if notes_list:
        lines.append(f"NOTES: {', '.join(notes_list)}")
        lines.append(f"{'-'*32}")
    lines.append("")
    lines.append("")

    return jsonify({
        "success": True,
        "kot_text": "\n".join(lines),
        "items": list(items_map.values()),
        "kot_no": kot_no,
        "table": table_no,
        "date": date_str,
        "time": time_str
    })

