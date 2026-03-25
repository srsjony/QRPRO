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
        username = request.form['username'].strip().upper()
        password = request.form['password']

        user = User.query.filter_by(username=username).first()

        if user and check_password_hash(user.password, password):
            if request.form.get('remember'):
                session.permanent = True
            else:
                session.permanent = False

            session['user_id'] = user.id
            session['username'] = username
            session['original_user_id'] = user.parent_id if user.parent_id else user.id

            if user.is_admin == 1:
                return redirect('/superadmin')

            # ONLY Main account can switch profiles
            if not user.parent_id:
                main_id = session['original_user_id']
                family_count = User.query.filter((User.id == main_id) | (User.parent_id == main_id)).count()

                if family_count > 1:
                    return redirect('/select_profile')

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

        if len(raw_password) < 8:
            flash('Password must be at least 8 characters', 'error')
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


@auth_bp.route('/select_profile', methods=['GET', 'POST'])
def select_profile():
    if 'original_user_id' not in session:
        return redirect('/')

    current_user = User.query.get(session['user_id'])
    if current_user and current_user.parent_id:
        return redirect('/dashboard')

    main_id = session['original_user_id']
    main_user = User.query.get(main_id)
    branches = User.query.filter_by(parent_id=main_id).all()

    if request.method == 'POST':
        selected_id = int(request.form.get('profile_id'))
        if selected_id == main_user.id or any(b.id == selected_id for b in branches):
            selected_user = User.query.get(selected_id)
            session['user_id'] = selected_user.id
            session['username'] = selected_user.username
            return redirect('/dashboard')
        flash('Invalid profile selected', 'error')

    return render_template('select_profile.html', main_user=main_user, branches=branches)


@auth_bp.route('/switch_branch/<int:target_id>')
def switch_branch(target_id):
    if 'original_user_id' not in session:
        return redirect('/')
    
    main_id = session['original_user_id']
    target_user = User.query.get(target_id)
    
    if target_user and (target_user.id == main_id or target_user.parent_id == main_id):
        session['user_id'] = target_user.id
        session['username'] = target_user.username
        
    return redirect('/dashboard')


@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect('/')
