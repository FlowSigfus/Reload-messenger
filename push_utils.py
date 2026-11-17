import os
from pywebpush import webpush, WebPushException
from database import PushSubscription
from dotenv import load_dotenv

load_dotenv()

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
print("Loaded VAPID_PUBLIC_KEY:", VAPID_PUBLIC_KEY)
print("Loaded VAPID_PRIVATE_KEY:", "present" if VAPID_PRIVATE_KEY else "MISSING")


def send_push_notification(user_id, title, body, db):
    if not VAPID_PRIVATE_KEY:
        print(f"[push] skipped for user {user_id} — VAPID_PRIVATE_KEY not set")
        return
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    if not subs:
        return
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                },
                data=f'{{"title":"{title}","body":"{body}","url":"/static/index.html"}}',
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": "mailto:mishaphost@yandex.ru"}
            )
        except WebPushException as e:
            if e.response and e.response.status_code == 410:
                print(f"[push] removing expired sub for user {user_id}")
                db.delete(sub)
                db.commit()
            else:
                print(f"[push] error for user {user_id}: {e}")
        except Exception as e:
            print(f"[push] unexpected error: {e}")


def cleanup_duplicate_subscriptions(user_id, db):
    subs = db.query(PushSubscription).filter(
        PushSubscription.user_id == user_id
    ).order_by(PushSubscription.created_at.desc()).all()
    if len(subs) > 1:
        for sub in subs[1:]:
            db.delete(sub)
        db.commit()
