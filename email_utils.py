import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

EMAIL_HOST = os.getenv("EMAIL_HOST")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", 587))
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")


def send_verification_email(to_email: str, token: str):
    subject = "Verify your email"
    body = f"Click the link to verify: {BASE_URL}/api/verify/{token}"
    return send_email(to_email, subject, body)


def send_warning_email(to_email: str, chat_id: int):
    subject = "Messages will be deleted soon"
    body = (
        f"Old messages in chat {chat_id} will be deleted in 2 days. "
        f"Download archive: {BASE_URL}/api/download_chat_archive/{chat_id}"
    )
    return send_email(to_email, subject, body)


def send_password_reset_email(to_email: str, token: str):
    reset_url = f"{BASE_URL}/static/index.html?reset_token={token}"
    subject = "Сброс пароля — Reload Messenger"
    body = (
        f"Перейдите по ссылке, чтобы сменить пароль:\n\n{reset_url}\n\n"
        f"Ссылка действует 1 час. Если вы не запрашивали сброс — проигнорируйте письмо."
    )
    return send_email(to_email, subject, body)


def send_2fa_code_email(to_email: str, code: str):
    subject = "Код подтверждения — Reload Messenger"
    body = (
        f"Ваш код для входа: {code}\n\n"
        f"Код действует 10 минут. Если вы не пытались войти — смените пароль."
    )
    return send_email(to_email, subject, body)


def send_email(to_email: str, subject: str, body: str) -> bool:
    if not all([EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD]):
        print(
            "\n=== EMAIL NOT CONFIGURED (dry-run) ===\n"
            f"To: {to_email}\nSubject: {subject}\n\n{body}\n"
            "=====================================\n"
        )
        return False
    try:
        msg = MIMEMultipart()
        msg['From'] = EMAIL_USER
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain', 'utf-8'))
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASSWORD)
            server.send_message(msg)
        print(f"✉️  Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email send failed to {to_email}: {e}")
        return False
