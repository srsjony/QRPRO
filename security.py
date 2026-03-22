import secrets

from flask import abort, request, session


CSRF_SESSION_KEY = "_csrf_token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def get_csrf_token():
    token = session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[CSRF_SESSION_KEY] = token
    return token


def validate_csrf_token():
    session_token = session.get(CSRF_SESSION_KEY)
    request_token = request.headers.get("X-CSRF-Token") or request.form.get("_csrf_token")

    if not session_token or not request_token:
        abort(400, description="Missing CSRF token")

    if not secrets.compare_digest(session_token, request_token):
        abort(400, description="Invalid CSRF token")


def init_csrf_protection(app):
    @app.before_request
    def csrf_protect():
        if request.method in SAFE_METHODS:
            return
        validate_csrf_token()

    @app.context_processor
    def inject_csrf_token():
        return {"csrf_token": get_csrf_token()}
