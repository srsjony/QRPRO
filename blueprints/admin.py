from flask import Blueprint, render_template, request, redirect, session, abort
from models import db, User, Menu
from functools import wraps
from datetime import datetime, timedelta, date

admin_bp = Blueprint('admin', __name__)


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect('/')
        user = User.query.get(session['user_id'])
        if not user or user.is_admin != 1:
            abort(403)
        return f(*args, **kwargs)
    return decorated


@admin_bp.route('/superadmin')
@admin_required
def superadmin():
    users = User.query.filter_by(is_admin=0).all()

    user_data = []
    for u in users:
        menu_count = Menu.query.filter_by(user_id=u.id).count()
        user_data.append({
            "id": u.id,
            "username": u.username,
            "whatsapp": u.whatsapp,
            "expiry": u.expiry,
            "menu_count": menu_count
        })

    return render_template("superadmin.html", users=user_data, today=str(date.today()))


@admin_bp.route('/extend/<int:id>')
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


@admin_bp.route('/set_expiry/<int:id>', methods=['GET', 'POST'])
@admin_required
def set_expiry(id):
    if request.method == 'POST':
        expiry = request.form['expiry']
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
        user.username = request.form['username']
        user.whatsapp = request.form['whatsapp']
        db.session.commit()
        return redirect('/superadmin')

    return render_template('edit_user.html', user=user)
