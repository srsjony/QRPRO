from flask import Blueprint, render_template, request, redirect, session, abort, flash
from models import db, User, Menu, Order
from functools import wraps
from datetime import datetime, timedelta, date
import re

admin_bp = Blueprint('admin', __name__)


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect('/')
        user = db.session.get(User, session['user_id'])
        if not user or user.is_admin != 1:
            abort(403)
        return f(*args, **kwargs)
    return decorated


@admin_bp.route('/superadmin')
@admin_required
def superadmin():
    users = User.query.filter_by(is_admin=0).all()
    menu_counts = dict(
        db.session.query(Menu.user_id, db.func.count(Menu.id))
        .group_by(Menu.user_id)
        .all()
    )

    user_data = []
    for u in users:
        user_data.append({
            "id": u.id,
            "username": u.username,
            "whatsapp": u.whatsapp,
            "expiry": u.expiry,
            "menu_count": menu_counts.get(u.id, 0),
            "parent_id": u.parent_id,
            "branch_name": u.branch_name
        })

    return render_template("superadmin.html", users=user_data, today=str(date.today()))


@admin_bp.route('/extend/<int:id>', methods=['POST'])
@admin_required
def extend(id):
    user = User.query.get_or_404(id)
    user.expiry = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
    db.session.commit()
    return redirect('/superadmin')


@admin_bp.route('/delete_user/<int:id>', methods=['POST'])
@admin_required
def delete_user(id):
    user = User.query.get_or_404(id)
    db.session.delete(user)
    db.session.commit()
    return redirect('/superadmin')


@admin_bp.route('/reset_user/<int:id>', methods=['POST'])
@admin_required
def reset_user(id):
    """Reset a user by clearing out all their old orders."""
    user = User.query.get_or_404(id)
    # Clear all orders for this user
    Order.query.filter_by(user_id=id).delete()
    
    db.session.commit()
    flash(f'User {user.username} has been reset (All orders wiped).', 'success')
    return redirect('/superadmin')


@admin_bp.route('/set_expiry/<int:id>', methods=['GET', 'POST'])
@admin_required
def set_expiry(id):
    if request.method == 'POST':
        expiry = request.form['expiry']
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', expiry):
            abort(400, description='Expiry must be in YYYY-MM-DD format.')
        user = User.query.get_or_404(id)
        user.expiry = expiry
        db.session.commit()
        return redirect('/superadmin')

    return render_template('set_expiry.html')


@admin_bp.route('/edit_user/<int:id>', methods=['GET', 'POST'])
@admin_required
def edit_user(id):
    user = User.query.get_or_404(id)

    if request.method == 'POST':
        username = request.form['username'].strip().upper()
        if not re.match(r'^[A-Z0-9_]+$', username):
            abort(400, description='Username can only contain letters, numbers, and underscores.')

        existing_user = User.query.filter(User.username == username, User.id != user.id).first()
        if existing_user:
            abort(400, description='Username already exists.')

        user.username = username
        user.whatsapp = request.form['whatsapp'].strip()
        db.session.commit()
        return redirect('/superadmin')

    return render_template('edit_user.html', user=user)

@admin_bp.route('/add_branch/<int:parent_id>', methods=['GET', 'POST'])
@admin_required
def add_branch(parent_id):
    parent = User.query.get_or_404(parent_id)
    if request.method == 'POST':
        username = request.form['username'].strip().upper()
        branch_name = request.form['branch_name'].strip()
        raw_password = request.form['password']
        whatsapp = request.form.get('whatsapp', parent.whatsapp).strip()
        
        from werkzeug.security import generate_password_hash
        if not re.match(r'^[A-Z0-9_]+$', username):
            abort(400, description='Username can only contain letters, numbers, and underscores.')
            
        if User.query.filter_by(username=username).first():
            abort(400, description='Username already exists.')
            
        password = generate_password_hash(raw_password)
        
        branch = User(username=username, password=password, whatsapp=whatsapp,
                      is_admin=0, parent_id=parent.id, branch_name=branch_name,
                      expiry=parent.expiry)
        db.session.add(branch)
        db.session.commit()
        
        from blueprints.auth import seed_menu
        seed_menu(branch.id)
        
        return redirect('/superadmin')
        
    return render_template('add_branch.html', parent=parent)
