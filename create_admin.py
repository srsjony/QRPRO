import subprocess
import sys

from werkzeug.security import generate_password_hash

from app import app
from models import db, User


subprocess.run([sys.executable, "-m", "flask", "--app", "app:create_app", "db", "upgrade"], check=True)

with app.app_context():
    existing_admin = User.query.filter_by(username="ADMIN").first()
    if existing_admin:
        print("Admin user already exists.")
    else:
        admin = User(
            username="ADMIN",
            password=generate_password_hash("admin12345"),
            is_admin=1,
        )
        db.session.add(admin)
        db.session.commit()
        print("Admin created successfully with username ADMIN and password admin12345")
