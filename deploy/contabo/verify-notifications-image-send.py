#!/usr/bin/env python3
"""Verify notification image upload + immediate OneSignal send on Nassani VPS."""
import json
import struct
import urllib.error
import urllib.request
import zlib

ENVF = "/var/www/nassani-admin/server/.env"
API = "https://api.nassanitv.online"


def admin_token():
    for line in open(ENVF, encoding="utf-8", errors="replace"):
        if line.startswith("ADMIN_API_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def png_bytes(w, h, rgb):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


token = admin_token()
img = png_bytes(32, 32, (200, 120, 40))
boundary = "----nassaniverify"
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="image"; filename="notif-test.png"\r\n'
    f"Content-Type: image/png\r\n\r\n"
).encode() + img + f"\r\n--{boundary}--\r\n".encode()

req = urllib.request.Request(
    f"{API}/api/notifications/prepare-image",
    data=body,
    method="POST",
    headers={"X-Admin-Token": token, "Content-Type": f"multipart/form-data; boundary={boundary}"},
)
with urllib.request.urlopen(req, timeout=45) as r:
    prep = json.loads(r.read().decode())
print("prepare_image", prep.get("ok"), prep.get("pushReady"), str(prep.get("previewUrl", ""))[:90])
assert prep.get("ok"), prep
assert str(prep.get("previewUrl", "")).startswith("https://api.nassanitv.online/uploads/")

with urllib.request.urlopen(prep["previewUrl"], timeout=20) as r:
    data = r.read(200)
    print("image_http", r.status, r.headers.get("Content-Type"), len(data))

payload = {
    "title": "Nassani Admin Verify Push",
    "message": "OneSignal integration verification — safe to ignore",
    "status": "sent",
    "destinationType": "home",
    "recurrenceKind": "once",
    "image": prep.get("imageForDb") or prep.get("image"),
}
req2 = urllib.request.Request(
    f"{API}/api/notifications",
    data=json.dumps(payload).encode(),
    method="POST",
    headers={"X-Admin-Token": token, "Content-Type": "application/json"},
)
with urllib.request.urlopen(req2, timeout=60) as r:
    sent = json.loads(r.read().decode())
print("send_immediate", r.status, sent.get("status"), sent.get("onesignalId"), sent.get("onesignalRecipients"))

if sent.get("id") and sent.get("onesignalId"):
    req3 = urllib.request.Request(
        f"{API}/api/notifications/{sent['id']}/sync-stats",
        data=b"{}",
        method="POST",
        headers={"X-Admin-Token": token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req3, timeout=30) as r3:
        stats = json.loads(r3.read().decode())
    print(
        "sync_stats",
        stats.get("onesignalDelivered"),
        stats.get("onesignalClicked"),
        stats.get("onesignalFailed"),
        stats.get("onesignalCtr"),
    )
    req4 = urllib.request.Request(
        f"{API}/api/notifications/{sent['id']}",
        method="DELETE",
        headers={"X-Admin-Token": token},
    )
    with urllib.request.urlopen(req4, timeout=20) as r4:
        print("delete_sent", r4.status)

print("IMAGE_AND_SEND_OK")
