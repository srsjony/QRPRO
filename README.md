# QR Menu System

A comprehensive restaurant QR menu management system built with Flask.

## Features

- **User Management**: Registration, login with admin and regular user roles
- **Menu Management**: Add, edit, delete menu items with image upload support
- **QR Code Generation**: Generate QR codes for restaurant menus (PNG & PDF formats)
- **Restaurant Settings**: Configure restaurant address, banner, and table numbers
- **Excel Import**: Bulk import menu items from Excel files
- **Admin Panel**: Super admin features for user management and expiry control
- **Responsive Design**: Mobile-friendly interface for both admin and customer views

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Apply database migrations:
   ```bash
   flask --app app:create_app db upgrade
   ```
4. Run the application:
   ```bash
   python app.py
   ```

## Deployment

The app is configured for easy deployment on platforms like Heroku, Render, or PythonAnywhere.

### Heroku Deployment
```bash
heroku create your-app-name
git push heroku main
```

### Render Deployment
- Create a new Web Service
- Build Command: `pip install -r requirements.txt`
- Start Command: `flask --app app:create_app db upgrade && gunicorn app:app`

## Usage

1. Register as a new user or use admin credentials
2. Add menu items to your restaurant
3. Generate QR codes for customer access
4. Customers scan QR codes to view the menu
5. Manage restaurant settings and user accounts

## Tech Stack

- **Backend**: Flask, SQLite
- **Frontend**: HTML, CSS, JavaScript
- **Image Processing**: Pillow
- **QR Generation**: qrcode
- **PDF Generation**: ReportLab
- **Excel Support**: pandas, openpyxl
- **Deployment**: Gunicorn

## File Structure

```
qr_menu_system/
├── app.py              # Main Flask application
├── database.db         # SQLite database
├── requirements.txt    # Python dependencies
├── Procfile           # Heroku deployment config
├── runtime.txt        # Python version specification
├── static/            # Static files (CSS, JS, uploads)
├── templates/         # HTML templates
└── README.md          # This file
```

## Default Admin

The system includes a super admin feature for managing users and system settings.

## License

This project is open source and available under the MIT License.
