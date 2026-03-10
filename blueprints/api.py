from flask import Blueprint, request, jsonify, session
from models import db, User, Menu, Order, OrderItem
from datetime import datetime

api_bp = Blueprint('api', __name__)


# ================= PLACE ORDER =================
@api_bp.route('/api/order', methods=['POST'])
def place_order():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400

    username = data.get('username')
    table = data.get('table')
    items = data.get('items', [])
    notes = data.get('notes', '').strip()

    if not username or not table or not items:
        return jsonify({"error": "Missing fields"}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    total = sum(i.get('price', 0) * i.get('qty', 1) for i in items)

    order = Order(
        user_id=user.id,
        table_no=str(table),
        notes=notes,
        total=total,
        status='pending',
        created_at=datetime.now()
    )
    db.session.add(order)
    db.session.flush()

    for i in items:
        order_item = OrderItem(
            order_id=order.id,
            item_name=i.get('name', ''),
            price=i.get('price', 0),
            quantity=i.get('qty', 1)
        )
        db.session.add(order_item)

    db.session.commit()

    return jsonify({"success": True, "order_id": order.id}), 201


# ================= KITCHEN ORDERS =================
@api_bp.route('/kitchen_orders/<username>')
def kitchen_orders(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"orders": []}), 404

    today = datetime.now().date()
    orders = Order.query.filter(
        Order.user_id == user.id,
        Order.status.notin_(['done', 'cancelled', 'settled']),
        db.func.date(Order.created_at) == today
    ).order_by(Order.created_at.desc()).all()

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
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"tables": {}}), 404

    active_orders = Order.query.filter(
        Order.user_id == user.id,
        Order.status.notin_(['settled', 'cancelled'])
    ).all()

    # Dictionary: table_no -> set of statuses. Just simple "occupied" if any order exists.
    occupied_tables = {o.table_no: "occupied" for o in active_orders}

    return jsonify({"tables": occupied_tables})


# ================= UPDATE ORDER STATUS =================
@api_bp.route('/update_order/<int:id>', methods=['POST'])
def update_order(id):
    order = Order.query.get_or_404(id)
    data = request.get_json()
    if data and 'status' in data:
        order.status = data['status']
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "No status"}), 400


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

    for o in orders:
        o.status = 'settled'

    db.session.commit()
    return jsonify({"success": True, "settled": len(orders)})


# ================= KITCHEN PAGE =================
@api_bp.route('/kitchen/<username>')
def kitchen(username):
    from flask import render_template
    user = User.query.filter_by(username=username).first()
    if not user:
        return "Not Found", 404
    return render_template('Kitchen.html', username=username)
