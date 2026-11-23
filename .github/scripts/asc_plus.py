"""The Reading Room Plus subscription in App Store Connect.

usage: asc_plus.py check   — shows the subscription's state, review note and review screenshot
       asc_plus.py review  — sets the review note (appstore/plus/review-note.txt) and uploads the review
                             screenshot (appstore/plus/review-screenshot.png), replacing an older one
       asc_plus.py submit  — sends the subscription to App Review (for the first one, with the app version
                             that goes to review next)
"""
import hashlib, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from asc_release import call, note, token, API
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


{"check": show, "review": review, "submit": submit}[sys.argv[1]]()
