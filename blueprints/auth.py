from flask import Blueprint, render_template, request, redirect, session, flash
import re
from werkzeug.security import generate_password_hash, check_password_hash
from models import db, User, Menu

auth_bp = Blueprint('auth', __name__)


SEED_MENU = [
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


def seed_menu(user_id):
    for item, price, category in SEED_MENU:
        db.session.add(Menu(user_id=user_id, item=item, price=price,
                            category=category, image=""))
    db.session.commit()


@auth_bp.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username'].strip()
        password = request.form['password']

        user = User.query.filter_by(username=username).first()

        if user and check_password_hash(user.password, password):
            session['user_id'] = user.id
            session['username'] = username

            if user.is_admin == 1:
                return redirect('/superadmin')

            return redirect('/dashboard')

        flash('Invalid username or password', 'error')

    return render_template('login.html')


@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username'].strip().upper()
        raw_password = request.form['password']
        whatsapp = request.form['whatsapp'].strip()

        # Sanitize: only alphanumeric and underscores
        if not re.match(r'^[A-Z0-9_]+$', username):
            flash('Username can only contain letters, numbers, and underscores', 'error')
            return render_template('login.html', register=True)

        if len(username) < 3:
            flash('Username must be at least 3 characters', 'error')
            return render_template('login.html', register=True)

        # Check duplicate
        if User.query.filter_by(username=username).first():
            flash('Username already taken. Please choose another.', 'error')
            return render_template('login.html', register=True)

        password = generate_password_hash(raw_password)
        user = User(username=username, password=password,
                    whatsapp=whatsapp, is_admin=0)
        db.session.add(user)
        db.session.commit()

        seed_menu(user.id)

        return redirect('/')

    return render_template('login.html', register=True)


@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect('/')
