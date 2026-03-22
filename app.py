from flask import Flask, jsonify, render_template, request
from flask_migrate import Migrate
from config import Config
from models import db
from security import init_csrf_protection
import os

from flask_socketio import join_room

from extensions import socketio

os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
migrate = Migrate()


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)
    migrate.init_app(app, db)
    init_csrf_protection(app)
    socketio.init_app(app)

    # Register blueprints
    from blueprints.auth import auth_bp
    from blueprints.admin import admin_bp
    from blueprints.menu_bp import menu_bp
    from blueprints.api import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(menu_bp)
    app.register_blueprint(api_bp)

    # Custom error pages
    @app.errorhandler(400)
    def bad_request(e):
        description = getattr(e, 'description', 'Bad request')
        if request.path.startswith('/api/') or request.is_json:
            return jsonify({"error": description}), 400
        return description, 400

    @app.errorhandler(413)
    def request_entity_too_large(e):
        if request.path.startswith('/api/') or request.is_json:
            return jsonify({"error": "Upload too large. Maximum size is 5 MB."}), 413
        return "Upload too large. Maximum size is 5 MB.", 413

    @app.errorhandler(404)
    def not_found(e):
        return render_template('404.html'), 404

    @app.errorhandler(500)
    def server_error(e):
        return render_template('500.html'), 500

    return app


app = create_app()

@socketio.on('join')
def on_join(data):
    username = data.get('username')
    if username:
        join_room(username)

if __name__ == '__main__':
    socketio.run(app, debug=Config.DEBUG, host='0.0.0.0',
                 port=int(os.environ.get('PORT', 5000)))
