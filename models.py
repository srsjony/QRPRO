from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date, timedelta

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    is_admin = db.Column(db.Integer, default=0)
    expiry = db.Column(db.String(20))
    whatsapp = db.Column(db.String(20))
    address = db.Column(db.String(300))
    banner = db.Column(db.String(200))
    logo = db.Column(db.String(200))
    upi_qr = db.Column(db.String(200))
    table_numbers = db.Column(db.String(500), default='1,2,3,4,5,6,7,8,9,10')
    slogan = db.Column(db.String(200), default='')
    theme_preset = db.Column(db.String(50), default='default')

    menu_items = db.relationship('Menu', backref='user', lazy=True, cascade='all, delete-orphan')
    orders = db.relationship('Order', backref='user', lazy=True, cascade='all, delete-orphan')


class Menu(db.Model):
    __tablename__ = 'menu'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    item = db.Column(db.String(200), nullable=False)
    price = db.Column(db.String(20), nullable=False)
    category = db.Column(db.String(100))
    image = db.Column(db.String(200))
    available = db.Column(db.Integer, default=1)  # 1=available, 0=out of stock


class Order(db.Model):
    __tablename__ = 'orders'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    table_no = db.Column(db.String(20), nullable=False)
    items = db.Column(db.Text)  # backward compat with old orders
    notes = db.Column(db.String(500), default='')
    total = db.Column(db.Float, default=0)
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.now)

    order_items = db.relationship('OrderItem', backref='order', lazy=True, cascade='all, delete-orphan')


class OrderItem(db.Model):
    __tablename__ = 'order_items'

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False)
    item_name = db.Column(db.String(200), nullable=False)
    price = db.Column(db.Float, nullable=False)
    quantity = db.Column(db.Integer, default=1)
