"""Print where The Reading Room stands in App Store Connect (review, versions, builds) as annotations."""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = "com.daviddaniels.readingroom"

def token():
    key = open(os.path.expanduser(f"~/private_keys/AuthKey_{os.environ['API_KEY_ID']}.p8")).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["API_ISSUER"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["API_KEY_ID"], "typ": "JWT"})

def get(path, **params):
    r = requests.get(API + path, headers={"Authorization": f"Bearer {token()}"}, params=params, timeout=60)
    if r.status_code >= 400:
        print(f"::warning title={path}::{r.status_code} {r.text[:300]}")
        return {"data": []}
    return r.json()

def note(title, msg):
    print(f"::notice title={title}::{msg}")

app = get("/apps", **{"filter[bundleId]": BUNDLE})["data"][0]
aid = app["id"]
for v in get(f"/apps/{aid}/appStoreVersions", limit=10)["data"]:
    a = v["attributes"]
    note(f"Version {a['platform']} {a['versionString']}", f"{a.get('appVersionState') or a.get('appStoreState')} (created {a.get('createdDate','')[:16]})")
for s in get("/reviewSubmissions", **{"filter[app]": aid, "limit": 10})["data"]:
    a = s["attributes"]
    note(f"Review submission {a.get('platform')}", f"{a.get('state')} submitted {str(a.get('submittedDate'))[:16]}")
for b in get("/builds", **{"filter[app]": aid, "sort": "-uploadedDate", "limit": 8, "include": "preReleaseVersion"})["data"]:
    a = b["attributes"]
    note(f"Build {a['version']}", f"{a.get('processingState')} uploaded {a.get('uploadedDate','')[:16]} expired={a.get('expired')}")
