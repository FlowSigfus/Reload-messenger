import os
import requests
from pywebpush import webpush, WebPushException
from database import PushSubscription
from dotenv import load_dotenv

load_dotenv()

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
print("Loaded VAPID_PUBLIC_KEY:", VAPID_PUBLIC_KEY)
print("Loaded VAPID_PRIVATE_KEY:", "present" if VAPID_PRIVATE_KEY else "MISSING")

def send_push_notification(user_id, title, body, db):
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    if not subs:
        print(f"No push subscription for user {user_id}")
        return
    print(f"Sending push to user {user_id}, {len(subs)} subscription(s)")
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
            print(f"Push sent to {sub.endpoint[:50]}...")
        except WebPushException as e:
            if e.response and e.response.status_code == 410:
                print(f"Removing expired subscription: {sub.endpoint[:50]}...")
                db.delete(sub)
                db.commit()
            else:
                print(f"Push error for {sub.endpoint[:50]}...: {e}")
        except Exception as e:
            print(f"Unexpected push error: {e}")

def cleanup_duplicate_subscriptions(user_id, db):
    subs = db.query(PushSubscription).filter(
        PushSubscription.user_id == user_id
    ).order_by(PushSubscription.created_at.desc()).all()
    if len(subs) > 1:
        for sub in subs[1:]:
            db.delete(sub)
        db.commit()
        print(f"Removed {len(subs)-1} duplicate subscriptions for user {user_id}")
