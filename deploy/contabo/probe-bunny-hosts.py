import urllib.request
hosts = [
  "nassani-media.b-cdn.net",
  "nassani.b-cdn.net",
  "nassanitv.b-cdn.net",
  "nassani-stream.b-cdn.net",
  "nassani-hls.b-cdn.net",
]
for h in hosts:
  url = f"https://{h}/api/health"
  try:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=20) as resp:
      body = resp.read(300).decode("utf-8","replace")
      print(f"{h} status={resp.status} server={resp.headers.get('Server')} cdn={resp.headers.get('CDN-PullZone')} body={body[:120]!r}")
  except Exception as e:
    code = getattr(e, "code", None)
    headers = getattr(e, "headers", None)
    server = headers.get("Server") if headers else None
    cdn = headers.get("CDN-PullZone") if headers else None
    print(f"{h} status={code} server={server} cdn={cdn} err={type(e).__name__}")
# Direct origin for comparison
try:
  with urllib.request.urlopen("https://api.nassanitv.online/api/health", timeout=20) as resp:
    print(f"origin status={resp.status} body={resp.read(80).decode()!r}")
except Exception as e:
    print(f"origin err={e}")
