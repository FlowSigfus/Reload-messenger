# gen_vapid.py
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import base64

private_key = ec.generate_private_key(ec.SECP256R1())
public_key = private_key.public_key()

def base64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

private_raw = private_key.private_numbers().private_value.to_bytes(32, 'big')
public_raw = public_key.public_numbers().x.to_bytes(32, 'big') + public_key.public_numbers().y.to_bytes(32, 'big')

public_b64 = base64url_encode(public_raw)
private_b64 = base64url_encode(private_raw)

print("VAPID_PUBLIC_KEY=" + public_b64)
print("VAPID_PRIVATE_KEY=" + private_b64)