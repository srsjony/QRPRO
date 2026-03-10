from app import app
from flaskwebgui import FlaskUI

if __name__ == '__main__':
    # Wrap the existing Flask app inside a native OS window
    FlaskUI(
        app=app,
        server="flask",
        width=1200,
        height=800,
        # 'app_mode=True' hides the browser address bar and tabs
        app_mode=True 
    ).run()
