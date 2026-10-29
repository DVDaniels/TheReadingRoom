"""Get the iPhone/iPad version ready in App Store Connect, and submit it.

usage: asc_ios.py prepare <build-number> <version> <video-url>
       asc_ios.py submit

prepare: sets the version number, copies the Mac listing (with the iPhone description), review contact and
notes, uploads appstore/screenshots/ios, and picks the build. submit: sends it to App Review.
"""
import glob, hashlib, os, sys, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = "com.daviddaniels.readingroom"


def token():
    key = open(os.path.expanduser(f"~/private_keys/AuthKey_{os.environ['API_KEY_ID']}.p8")).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["API_ISSUER"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["API_KEY_ID"], "typ": "JWT"})


def call(method, path, ok_missing=False, **kw):
    r = requests.request(method, path if path.startswith("http") else API + path,
                         headers={"Authorization": f"Bearer {token()}"}, timeout=120, **kw)
    if r.status_code == 404 and ok_missing:
        return None
    if r.status_code >= 400:
        print(f"::error title={method} {path[:80]}::{r.status_code} {r.text[:1800]}")
        sys.exit(1)
    return r.json() if r.content else {}


def note(t, m):
    print(f"::notice title={t}::{m}")


app = call("GET", "/apps", params={"filter[bundleId]": BUNDLE})["data"][0]
AID = app["id"]


def version(platform):
    vs = call("GET", f"/apps/{AID}/appStoreVersions", params={"filter[platform]": platform, "limit": 10})["data"]
    return vs[0] if vs else None


def prepare(build_no, version_string, video):
    ios = version("IOS")
    mac = version("MAC_OS")
    note("iOS version", f"{ios['attributes']['versionString']} {ios['attributes'].get('appVersionState')}")

    call("PATCH", f"/appStoreVersions/{ios['id']}", json={"data": {"type": "appStoreVersions", "id": ios["id"], "attributes": {
        "versionString": version_string, "copyright": mac["attributes"].get("copyright") or "© 2026 David Daniels",
        "releaseType": "AFTER_APPROVAL"}}})
    note("Version", version_string)

    # Listing text, from the Mac version (with the iPhone description)
    mac_loc = call("GET", f"/appStoreVersions/{mac['id']}/appStoreVersionLocalizations")["data"][0]["attributes"]
    ios_locs = call("GET", f"/appStoreVersions/{ios['id']}/appStoreVersionLocalizations")["data"]
    attrs = {k: mac_loc.get(k) for k in ("keywords", "promotionalText", "supportUrl", "marketingUrl") if mac_loc.get(k)}
    attrs["description"] = open("appstore/ios-description.txt").read().strip()
    if ios_locs:
        loc = ios_locs[0]
        call("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", json={"data": {"type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": attrs}})
    else:
        loc = call("POST", "/appStoreVersionLocalizations", json={"data": {"type": "appStoreVersionLocalizations",
            "attributes": {"locale": mac_loc.get("locale", "en-US"), **attrs},
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": ios["id"]}}}}})["data"]
    note("Listing", f"{loc['attributes'].get('locale')}: description, keywords, promotional text and links set")

    # App Review contact and notes
    mac_rd = (call("GET", f"/appStoreVersions/{mac['id']}/appStoreReviewDetail").get("data") or {}).get("attributes", {})
    rd_attrs = {k: mac_rd.get(k) for k in ("contactFirstName", "contactLastName", "contactPhone", "contactEmail") if mac_rd.get(k)}
    rd_attrs.update({"demoAccountRequired": False,
                     "notes": open("appstore/ios-review-notes.txt").read().strip().replace("VIDEO_URL", video)})
    rd = call("GET", f"/appStoreVersions/{ios['id']}/appStoreReviewDetail").get("data")
    if rd:
        call("PATCH", f"/appStoreReviewDetails/{rd['id']}", json={"data": {"type": "appStoreReviewDetails", "id": rd["id"], "attributes": rd_attrs}})
    else:
        call("POST", "/appStoreReviewDetails", json={"data": {"type": "appStoreReviewDetails", "attributes": rd_attrs,
             "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": ios["id"]}}}}})
    note("App Review", f"contact {'set' if rd_attrs.get('contactEmail') else 'MISSING'}, notes {len(rd_attrs['notes'])} characters")

    # Screenshots: 6.7" iPhone and 12.9"/13" iPad
    sets = {s["attributes"]["screenshotDisplayType"]: s for s in
            call("GET", f"/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")["data"]}
    for kind, pattern in (("APP_IPHONE_67", "iphone-*.png"), ("APP_IPAD_PRO_3GEN_129", "ipad-*.png")):
        s = sets.get(kind) or call("POST", "/appScreenshotSets", json={"data": {"type": "appScreenshotSets",
            "attributes": {"screenshotDisplayType": kind},
            "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"]}}}}})["data"]
        for old in call("GET", f"/appScreenshotSets/{s['id']}/appScreenshots")["data"]:
            call("DELETE", f"/appScreenshots/{old['id']}")
        files = sorted(glob.glob(f"appstore/screenshots/ios/{pattern}"))
        for f in files:
            data = open(f, "rb").read()
            shot = call("POST", "/appScreenshots", json={"data": {"type": "appScreenshots",
                "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
                "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": s["id"]}}}}})["data"]
            for op in shot["attributes"]["uploadOperations"]:
                part = data[op["offset"]: op["offset"] + op["length"]]
                h = {x["name"]: x["value"] for x in op.get("requestHeaders", [])}
                r = requests.request(op["method"], op["url"], headers=h, data=part, timeout=120)
                if r.status_code >= 300:
                    print(f"::error title=Upload {f}::{r.status_code} {r.text[:500]}")
                    sys.exit(1)
            call("PATCH", f"/appScreenshots/{shot['id']}", json={"data": {"type": "appScreenshots", "id": shot["id"],
                 "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
        note("Screenshots", f"{kind}: {len(files)} uploaded")

    # The build
    builds = call("GET", "/builds", params={"filter[app]": AID, "filter[version]": build_no,
                                             "filter[preReleaseVersion.platform]": "IOS", "limit": 5})["data"]
    if not builds:
        print(f"::error title=Build::No iOS build {build_no} found")
        sys.exit(1)
    b = builds[0]
    note("Build", f"{build_no} {b['attributes'].get('processingState')}")
    call("PATCH", f"/appStoreVersions/{ios['id']}/relationships/build", json={"data": {"type": "builds", "id": b["id"]}})
    note("Build selected", build_no)


def submit():
    ios = version("IOS")
    subs = call("GET", "/reviewSubmissions", params={"filter[app]": AID, "filter[platform]": "IOS", "limit": 10})["data"]
    sub = next((s for s in subs if s["attributes"].get("state") in ("READY_FOR_REVIEW", "UNRESOLVED_ISSUES")), None)
    if not sub:
        sub = call("POST", "/reviewSubmissions", json={"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
              "relationships": {"app": {"data": {"type": "apps", "id": AID}}}}})["data"]
        call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems",
             "relationships": {"reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                               "appStoreVersion": {"data": {"type": "appStoreVersions", "id": ios["id"]}}}}})
    out = call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})
    note("Submitted", out["data"]["attributes"].get("state"))


if sys.argv[1] == "prepare":
    prepare(sys.argv[2], sys.argv[3], sys.argv[4])
else:
    submit()
