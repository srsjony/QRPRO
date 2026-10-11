from flask_socketio import SocketIO

socketio = SocketIO(
    async_mode="threading",
    cors_allowed_origins="*",
    ping_interval=25,
    ping_timeout=20,
)
