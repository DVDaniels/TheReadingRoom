"""Mac App Store review helpers: put the review notes on the Mac version, or resubmit it for review.

usage: asc_review.py notes [video_url] | resubmit
"""
import os, sys, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = "com.daviddaniels.readingroom"

def token():
    key = open(os.path.expanduser(f"~/private_keys/AuthKey_{os.environ['API_KEY_ID']}.p8")).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["API_ISSUER"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["API_KEY_ID"], "typ": "JWT"})

def call(method, path, **kw):
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token()}"}, timeout=60, **kw)
    if r.status_code >= 400:
        errs = r.text
        print(f"::error title={method} {path}::{r.status_code} {errs[:1500]}")
        sys.exit(1)
    return r.json() if r.content else {}

app = call("GET", "/apps", params={"filter[bundleId]": BUNDLE})["data"][0]
versions = call("GET", f"/apps/{app['id']}/appStoreVersions", params={"filter[platform]": "MAC_OS", "limit": 5})["data"]
mac = versions[0]
print(f"::notice title=Mac version::{mac['attributes']['versionString']} {mac['attributes'].get('appVersionState')}")

if sys.argv[1] == "notes":
    video = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else ""
    text = open("appstore/review-notes.txt").read().strip()
    text = text.replace("VIDEO_LINE ", f"A screen recording captured on a Mac running the latest macOS with the submitted build, starting from launch: {video} " if video else "Attached to our reply in App Review. ")
    detail = call("GET", f"/appStoreVersions/{mac['id']}/appStoreReviewDetail").get("data")
    if detail:
        call("PATCH", f"/appStoreReviewDetails/{detail['id']}", json={"data": {"type": "appStoreReviewDetails", "id": detail["id"], "attributes": {"notes": text}}})
    else:
        call("POST", "/appStoreReviewDetails", json={"data": {"type": "appStoreReviewDetails", "attributes": {"notes": text},
             "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": mac["id"]}}}}})
    print(f"::notice title=Review notes::Saved ({len(text)} characters)")

elif sys.argv[1] == "resubmit":
    subs = call("GET", "/reviewSubmissions", params={"filter[app]": app["id"], "filter[platform]": "MAC_OS", "limit": 10})["data"]
    open_subs = [s for s in subs if s["attributes"].get("state") in ("UNRESOLVED_ISSUES", "READY_FOR_REVIEW")]
    if not open_subs:
        print("::error title=Resubmit::No open Mac review submission found: " + ", ".join(s["attributes"].get("state", "") for s in subs))
        sys.exit(1)
    s = open_subs[0]
    # Rejected items have to be marked as dealt with before the submission can go back to App Review.
    items = call("GET", f"/reviewSubmissions/{s['id']}/items")["data"]
    for it in items:
        st = it["attributes"].get("state")
        print(f"::notice title=Item::{it['id']} {st} resolved={it['attributes'].get('resolved')}")
        if st in ("REJECTED", "UNRESOLVED_ISSUES") or it["attributes"].get("resolved") is False:
            call("PATCH", f"/reviewSubmissionItems/{it['id']}", json={"data": {"type": "reviewSubmissionItems", "id": it["id"], "attributes": {"resolved": True}}})
            print(f"::notice title=Item resolved::{it['id']}")
    out = call("PATCH", f"/reviewSubmissions/{s['id']}", json={"data": {"type": "reviewSubmissions", "id": s["id"], "attributes": {"submitted": True}}})
    print(f"::notice title=Resubmitted::{out['data']['attributes'].get('state')}")
