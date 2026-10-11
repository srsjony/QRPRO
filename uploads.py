import os
import secrets
from pathlib import Path

from flask import current_app
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_WIDTH = 800
JPEG_QUALITY = 85


def save_uploaded_image(file_storage):
    if not file_storage or not file_storage.filename:
        return ""

    original_name = secure_filename(file_storage.filename)
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError("Please upload a JPG, PNG, or WEBP image.")

    upload_folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_folder, exist_ok=True)

    token = secrets.token_hex(16)
    temp_filename = f"{token}_raw{extension}"
    final_filename = f"{token}.jpg"
    temp_path = os.path.join(upload_folder, temp_filename)
    final_path = os.path.join(upload_folder, final_filename)

    try:
        file_storage.save(temp_path)

        with Image.open(temp_path) as image:
            image.verify()

        with Image.open(temp_path) as image:
            if image.mode != "RGB":
                image = image.convert("RGB")

            if image.width > MAX_IMAGE_WIDTH:
                ratio = MAX_IMAGE_WIDTH / image.width
                image = image.resize(
                    (MAX_IMAGE_WIDTH, int(image.height * ratio)),
                    Image.LANCZOS,
                )

            image.save(final_path, "JPEG", quality=JPEG_QUALITY, optimize=True)

        return final_filename
    except (OSError, UnidentifiedImageError, ValueError) as exc:
        if os.path.exists(final_path):
            os.remove(final_path)
        raise ValueError("Invalid image upload.") from exc
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
