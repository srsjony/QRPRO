from flask import Flask
from config import Config
from models import db
import os

os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)

    # Register blueprints
    from blueprints.auth import auth_bp
    from blueprints.admin import admin_bp
    from blueprints.menu_bp import menu_bp
    from blueprints.api import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(menu_bp)
    app.register_blueprint(api_bp)

    with app.app_context():
        db.create_all()

        # Backward-compatible migration: ensure tables have all columns
        _migrate_existing_db(app)

    return app


def _migrate_existing_db(app):
    """Handle migration from raw SQL schema to SQLAlchemy models.
    Creates new tables (orders, order_items) if they don't exist.
    Adds missing columns to existing tables."""
    import sqlite3

    db_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    if not os.path.exists(db_path):
        return

    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Check if users table has table_numbers column
    c.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in c.fetchall()]
    if "table_numbers" not in user_columns:
        c.execute("ALTER TABLE users ADD COLUMN table_numbers TEXT")
    if "logo" not in user_columns:
        c.execute("ALTER TABLE users ADD COLUMN logo TEXT")
    if "upi_qr" not in user_columns:
        c.execute("ALTER TABLE users ADD COLUMN upi_qr TEXT")

    c.execute("""
        UPDATE users
        SET table_numbers=?
        WHERE table_numbers IS NULL OR TRIM(table_numbers)=''
    """, (Config.DEFAULT_TABLE_NUMBERS,))

    conn.commit()
    conn.close()


app = create_app()


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0',
            port=int(os.environ.get('PORT', 5000)))