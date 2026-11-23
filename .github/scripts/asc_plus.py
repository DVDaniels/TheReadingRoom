"""The Reading Room Plus subscription in App Store Connect.

usage: asc_plus.py check   — shows the subscription's state, review note and review screenshot
       asc_plus.py review  — sets the review note (appstore/plus/review-note.txt) and uploads the review
                             screenshot (appstore/plus/review-screenshot.png), replacing an older one
       asc_plus.py submit  — sends the subscription to App Review (for the first one, with the app version
                             that goes to review next)
"""
import hashlib, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from asc_release import call, note, token, API, AID, versions
import requests

SUB = "6837848076"   # Plus yearly, com.daviddaniels.readingroom.plus.yearly
GROUP = "22603996"   # The Reading Room Plus


def show():
    s = call("GET", f"/subscriptions/{SUB}")["data"]["attributes"]
    note("Plus yearly", f"state {s.get('state')}; product {s.get('productId')}; review note: {'set' if s.get('reviewNote') else 'missing'}")
    shot = call("GET", f"/subscriptions/{SUB}/appStoreReviewScreenshot").get("data")
    a = (shot or {}).get("attributes") or {}
    note("Review screenshot", f"{a.get('fileName')} {a.get('assetDeliveryState', {}).get('state')}" if shot else "none")
    if sys.argv[1] == "check":
        def get(path, **kw):
            try:
                r = requests.get(API + path, headers={"Authorization": f"Bearer {token()}"}, timeout=60, **kw)
                return r.json() if r.content else {}
            except Exception as e:
                return {"error": str(e)}
        locs = get(f"/subscriptions/{SUB}/subscriptionLocalizations").get("data", [])
        note("Localizations", "; ".join(f"{l['attributes'].get('locale')} {l['attributes'].get('state')} '{l['attributes'].get('name')}'" for l in locs) or "none")
        prices = get(f"/subscriptions/{SUB}/prices", params={"limit": 200})
        note("Prices", f"{len(prices.get('data', []))} territories" + (f" {prices.get('errors')}" if prices.get("errors") else ""))
        av = get(f"/subscriptions/{SUB}/subscriptionAvailability")
        note("Availability", str((av.get("data") or {}).get("attributes")) + (f" {av.get('errors')}" if av.get("errors") else ""))
        intro = get(f"/subscriptions/{SUB}/introductoryOffers")
        note("Free week offers", f"{len(intro.get('data', []))}")
        glr = get(f"/subscriptionGroups/{GROUP}/subscriptionGroupLocalizations")
        gl = glr.get("data", [])
        if glr.get("errors"): note("Group localizations error", str(glr["errors"])[:300])
        note("Group localizations", "; ".join(f"{l['attributes'].get('locale')} {l['attributes'].get('state')} '{l['attributes'].get('name')}'" for l in gl) or "none")
        note("Subscription attrs", str({k: v for k, v in s.items() if k != 'reviewNote'}))
    return s, shot


def group_name():
    """The subscription group needs a display name (what people see in their Subscriptions list)."""
    have = call("GET", f"/subscriptionGroups/{GROUP}/subscriptionGroupLocalizations")["data"]
    if not any(l["attributes"].get("locale") == "en-US" for l in have):
        call("POST", "/subscriptionGroupLocalizations", json={"data": {"type": "subscriptionGroupLocalizations",
             "attributes": {"locale": "en-US", "name": "The Reading Room Plus"},
             "relationships": {"subscriptionGroup": {"data": {"type": "subscriptionGroups", "id": GROUP}}}}})
        note("Group name", "en-US: The Reading Room Plus")


def review():
    group_name()
    call("PATCH", f"/subscriptions/{SUB}", json={"data": {"type": "subscriptions", "id": SUB,
         "attributes": {"reviewNote": open("appstore/plus/review-note.txt").read().strip()}}})
    note("Review note", "set")
    _, old = show()
    if old:
        call("DELETE", f"/subscriptionAppStoreReviewScreenshots/{old['id']}")
        note("Review screenshot", "old one removed")
    data = open("appstore/plus/review-screenshot.png", "rb").read()
    r = call("POST", "/subscriptionAppStoreReviewScreenshots", json={"data": {"type": "subscriptionAppStoreReviewScreenshots",
             "attributes": {"fileName": "plus-review.png", "fileSize": len(data)},
             "relationships": {"subscription": {"data": {"type": "subscriptions", "id": SUB}}}}})["data"]
    for op in r["attributes"]["uploadOperations"]:
        part = data[op["offset"]:op["offset"] + op["length"]]
        requests.request(op["method"], op["url"], data=part, timeout=120,
                         headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])}).raise_for_status()
    call("PATCH", f"/subscriptionAppStoreReviewScreenshots/{r['id']}", json={"data": {"type": "subscriptionAppStoreReviewScreenshots",
         "id": r["id"], "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    note("Review screenshot", "uploaded")
    show()


def submit():
    call("POST", "/subscriptionSubmissions", json={"data": {"type": "subscriptionSubmissions",
         "relationships": {"subscription": {"data": {"type": "subscriptions", "id": SUB}}}}})
    note("Plus yearly", "sent to App Review")
    show()


def together(version_string):
    """The first subscription must go with an app version: open the iPhone/iPad review submission, add the version,
    send Plus, then submit both. If Apple won't take Plus, nothing is submitted."""
    v = next((x for x in versions("IOS") if x["attributes"]["versionString"] == version_string), None)
    if not v:
        print(f"::error title=Version::No iPhone/iPad {version_string}"); sys.exit(1)
    b = call("GET", f"/appStoreVersions/{v['id']}/build").get("data")
    if b and b["attributes"].get("usesNonExemptEncryption") is None:
        call("PATCH", f"/builds/{b['id']}", json={"data": {"type": "builds", "id": b["id"], "attributes": {"usesNonExemptEncryption": False}}})
        note("Export compliance", "Answered: uses only standard (exempt) encryption")
    subs = call("GET", "/reviewSubmissions", params={"filter[app]": AID, "filter[platform]": "IOS", "limit": 20})["data"]
    sub = next((s for s in subs if s["attributes"].get("state") == "READY_FOR_REVIEW"), None)
    if not sub:
        sub = call("POST", "/reviewSubmissions", json={"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
              "relationships": {"app": {"data": {"type": "apps", "id": AID}}}}})["data"]
    if not call("GET", f"/reviewSubmissions/{sub['id']}/items")["data"]:
        call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems",
             "relationships": {"reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                               "appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
    note("iPhone/iPad", f"version {version_string} added to review submission {sub['id']} (not sent yet)")
    try:
        submit()
    except SystemExit:
        print("::error title=Plus::Apple wouldn't take Plus with the version this way. Nothing was submitted; the iPhone/iPad version is waiting in a review submission.")
        sys.exit(1)
    out = call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"],
               "attributes": {"submitted": True}}})
    note("Submitted iPhone/iPad " + version_string, out["data"]["attributes"].get("state"))
    items = call("GET", f"/reviewSubmissions/{sub['id']}/items")["data"]
    note("Items in the submission", "; ".join(str({k: v for k, v in i["attributes"].items() if v}) for i in items))


def clear():
    """Take back an unsent iPhone/iPad review submission (left by a together try), so the version page is plain again."""
    for s in call("GET", "/reviewSubmissions", params={"filter[app]": AID, "filter[platform]": "IOS", "limit": 20})["data"]:
        if s["attributes"].get("state") == "READY_FOR_REVIEW":
            for it in call("GET", f"/reviewSubmissions/{s['id']}/items")["data"]:
                call("DELETE", f"/reviewSubmissionItems/{it['id']}")
                note("Unsent iOS submission", f"took the version back out of {s['id']}")


a = sys.argv[1]
if a == "clear": clear(); sys.exit(0)
together(sys.argv[2]) if a == "together" else {"check": show, "review": review, "submit": submit}[a]()
