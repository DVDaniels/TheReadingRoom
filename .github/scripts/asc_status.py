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
note("App Store link", f"https://apps.apple.com/us/app/id{aid}  ({app['attributes'].get('name')})")
for b in get("/builds", **{"filter[app]": aid, "sort": "-uploadedDate", "limit": 4, "include": "preReleaseVersion"})["data"]:
    a = b["attributes"]
    note(f"Build {a['version']}", f"{a.get('processingState')} uploaded {a.get('uploadedDate','')[:16]} expired={a.get('expired')}")
for v in get(f"/apps/{aid}/appStoreVersions", limit=10)["data"]:
    a = v["attributes"]
    note(f"Version {a['platform']} {a['versionString']}", f"{a.get('appVersionState') or a.get('appStoreState')} (created {a.get('createdDate','')[:16]})")
for s in get("/reviewSubmissions", **{"filter[app]": aid, "limit": 10})["data"]:
    a = s["attributes"]
    note(f"Review submission {a.get('platform')}", f"{a.get('state')} submitted {str(a.get('submittedDate'))[:16]}")

# ---- TestFlight: the public link and how each recent build stands with outside testers
for g in get(f"/apps/{aid}/betaGroups", limit=50)["data"]:
    a = g["attributes"]
    if a.get("isInternalGroup"):
        continue
    link = a.get("publicLink") if a.get("publicLinkEnabled") else "public link turned off"
    limit = f", limit {a.get('publicLinkLimit')} testers" if a.get("publicLinkLimitEnabled") else ""
    note(f"TestFlight group {a.get('name')}", f"{link or 'no public link yet'}{limit}")
    builds = get(f"/betaGroups/{g['id']}/builds", limit=50)["data"]
    nums = sorted((b["attributes"]["version"] for b in builds), key=lambda v: int(v) if v.isdigit() else 0, reverse=True)[:8]
    note(f"In {a.get('name')}", "builds " + ", ".join(nums))
for b in get("/builds", **{"filter[app]": aid, "sort": "-uploadedDate", "limit": 8, "include": "preReleaseVersion"})["data"]:
    num = b["attributes"]["version"]
    d = get(f"/builds/{b['id']}/buildBetaDetail").get("data") or {}
    r = get(f"/builds/{b['id']}/betaAppReviewSubmission").get("data") or {}
    plat = "Mac" if int(num) >= 1000 else "iPhone/iPad" if num.isdigit() else ""
    note(f"Tester build {num} ({plat})",
         f"testers: {(d.get('attributes') or {}).get('externalBuildState')}; beta review: {(r.get('attributes') or {}).get('betaReviewState', 'not submitted')}")
