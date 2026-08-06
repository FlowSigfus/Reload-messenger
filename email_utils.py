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

def send_verification_email(to_email: str, token: str):
    subject = "Verify your email"
    body = f"Click the link to verify: http://your-domain.com/api/verify/{token}"
    send_email(to_email, subject, body)

def send_warning_email(to_email: str, chat_id: int):
    subject = "Messages will be deleted soon"
    body = f"Old messages in chat {chat_id} will be deleted in 2 days. Download archive: http://your-domain.com/api/download_chat_archive/{chat_id}"
    send_email(to_email, subject, body)

def send_email(to_email: str, subject: str, body: str):
    msg = MIMEMultipart()
    msg['From'] = EMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))
    with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASSWORD)
        server.send_message(msg)