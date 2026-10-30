"""Get an update ready in App Store Connect and send it to App Review, for the Mac, iPhone/iPad, or both.

usage: asc_release.py prepare <MAC_OS|IOS|both> <version> [build]
       asc_release.py submit  <MAC_OS|IOS|both> <version>

prepare: makes the new version (once the one before it is approved), fills in What's New, the description,
promotional text, keywords and App Review notes from appstore/<version>/, and picks the build (the newest
valid build of that version, unless a build number is given). Screenshots carry over from the last version.
submit: sends that version to App Review.
"""
import os, sys, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = "com.daviddaniels.readingroom"
DONE = {"READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "PENDING_DEVELOPER_RELEASE", "PROCESSING_FOR_DISTRIBUTION",
        "PROCESSING_FOR_APP_STORE", "REPLACED_WITH_NEW_VERSION", "ACCEPTED"}
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}


def token():
    key = open(os.path.expanduser(f"~/private_keys/AuthKey_{os.environ['API_KEY_ID']}.p8")).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["API_ISSUER"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["API_KEY_ID"], "typ": "JWT"})


def call(method, path, **kw):
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token()}"}, timeout=120, **kw)
    if r.status_code >= 400:
        detail = "; ".join(e.get("detail") or e.get("title", "") for e in r.json().get("errors", [])) if r.content else ""
        print(f"::error title={method} {path[:70]}::{r.status_code} {detail[:1500]}")
        sys.exit(1)
    return r.json() if r.content else {}


def note(t, m):
    print(f"::notice title={t}::{m}")


def text(version, name, fallback=None):
    for p in (f"appstore/{version}/{name}", fallback):
        if p and os.path.exists(p):
            return open(p).read().strip()
    return None


AID = call("GET", "/apps", params={"filter[bundleId]": BUNDLE})["data"][0]["id"]
LABEL = {"MAC_OS": "Mac", "IOS": "iPhone and iPad"}


def versions(platform):
    return call("GET", f"/apps/{AID}/appStoreVersions", params={"filter[platform]": platform, "limit": 20})["data"]


def state(v):
    return v["attributes"].get("appVersionState") or v["attributes"].get("appStoreState")


def find_or_make(platform, version_string):
    vs = versions(platform)
    for v in vs:
        if v["attributes"]["versionString"] == version_string:
            return v
    # An earlier version still in review or being prepared blocks a new one
    open_ = [v for v in vs if state(v) not in DONE]
    if open_:
        o = open_[0]
        print(f"::error title={LABEL[platform]} {version_string}::Version {o['attributes']['versionString']} is still "
              f"{state(o)}. Apple allows one version in progress at a time, so run this again once it's approved.")
        sys.exit(1)
    v = call("POST", "/appStoreVersions", json={"data": {"type": "appStoreVersions",
        "attributes": {"platform": platform, "versionString": version_string, "releaseType": "AFTER_APPROVAL"},
        "relationships": {"app": {"data": {"type": "apps", "id": AID}}}}})["data"]
    note(f"{LABEL[platform]} {version_string}", "New version made")
    return v


def prepare(platform, version_string, build_no):
    v = find_or_make(platform, version_string)
    if state(v) not in EDITABLE:
        print(f"::error title={LABEL[platform]} {version_string}::It's {state(v)} and can't be changed now.")
        sys.exit(1)
    call("PATCH", f"/appStoreVersions/{v['id']}", json={"data": {"type": "appStoreVersions", "id": v["id"],
         "attributes": {"copyright": f"© {time.strftime('%Y')} David Daniels", "releaseType": "AFTER_APPROVAL"}}})

    kind = "mac" if platform == "MAC_OS" else "ios"
    attrs = {
        "whatsNew": text(version_string, "whats-new.txt"),
        "description": text(version_string, f"description-{kind}.txt"),
        "promotionalText": text(version_string, "promo.txt"),
        "keywords": text(version_string, "keywords.txt"),
    }
    attrs = {k: v_ for k, v_ in attrs.items() if v_}
    locs = call("GET", f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations")["data"]
    if not locs:
        print(f"::error title=Listing::No listing language on {LABEL[platform]} {version_string}.")
        sys.exit(1)
    for loc in locs:
        call("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", json={"data": {"type": "appStoreVersionLocalizations",
             "id": loc["id"], "attributes": attrs}})
        note("Listing", f"{loc['attributes'].get('locale')}: " + ", ".join(sorted(attrs)))

    notes = text(version_string, "review-notes.txt")
    if notes:
        rd = call("GET", f"/appStoreVersions/{v['id']}/appStoreReviewDetail").get("data")
        if rd:
            call("PATCH", f"/appStoreReviewDetails/{rd['id']}", json={"data": {"type": "appStoreReviewDetails",
                 "id": rd["id"], "attributes": {"notes": notes}}})
        else:
            prev = next((x for x in versions(platform) if x["id"] != v["id"]), None)
            contact = {}
            if prev:
                pr = (call("GET", f"/appStoreVersions/{prev['id']}/appStoreReviewDetail").get("data") or {}).get("attributes", {})
                contact = {k: pr[k] for k in ("contactFirstName", "contactLastName", "contactPhone", "contactEmail") if pr.get(k)}
            call("POST", "/appStoreReviewDetails", json={"data": {"type": "appStoreReviewDetails",
                 "attributes": {**contact, "demoAccountRequired": False, "notes": notes},
                 "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
        note("App Review notes", f"{len(notes)} characters")

    params = {"filter[app]": AID, "filter[preReleaseVersion.platform]": platform,
              "filter[preReleaseVersion.version]": version_string, "filter[processingState]": "VALID",
              "sort": "-uploadedDate", "limit": 20}
    if build_no:
        params["filter[version]"] = build_no
    builds = [b for b in call("GET", "/builds", params=params)["data"] if not b["attributes"].get("expired")]
    if not builds:
        print(f"::error title=Build::No ready {LABEL[platform]} build of {version_string}{' number ' + build_no if build_no else ''}.")
        sys.exit(1)
    b = builds[0]
    call("PATCH", f"/appStoreVersions/{v['id']}/relationships/build", json={"data": {"type": "builds", "id": b["id"]}})
    note("Build", f"{LABEL[platform]} {version_string} build {b['attributes']['version']} (uploaded {b['attributes'].get('uploadedDate', '')[:16]})")


def submit(platform, version_string):
    v = next((x for x in versions(platform) if x["attributes"]["versionString"] == version_string), None)
    if not v:
        print(f"::error title=Submit::No {LABEL[platform]} version {version_string}. Run prepare first.")
        sys.exit(1)
    subs = call("GET", "/reviewSubmissions", params={"filter[app]": AID, "filter[platform]": platform, "limit": 20})["data"]
    sub = next((s for s in subs if s["attributes"].get("state") in ("READY_FOR_REVIEW", "UNRESOLVED_ISSUES")), None)
    if not sub:
        sub = call("POST", "/reviewSubmissions", json={"data": {"type": "reviewSubmissions", "attributes": {"platform": platform},
              "relationships": {"app": {"data": {"type": "apps", "id": AID}}}}})["data"]
    items = call("GET", f"/reviewSubmissions/{sub['id']}/items")["data"]
    if not items:
        call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems",
             "relationships": {"reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                               "appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
    else:
        for it in items:  # answered issues from an earlier round count as resolved
            if it["attributes"].get("state") == "UNRESOLVED":
                call("PATCH", f"/reviewSubmissionItems/{it['id']}", json={"data": {"type": "reviewSubmissionItems",
                     "id": it["id"], "attributes": {"resolved": True}}})
    out = call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"],
               "attributes": {"submitted": True}}})
    note(f"Submitted {LABEL[platform]} {version_string}", out["data"]["attributes"].get("state"))


if __name__ == "__main__":
    action, which, version_string = sys.argv[1], sys.argv[2], sys.argv[3]
    build_no = sys.argv[4] if len(sys.argv) > 4 else ""
    for platform in (["MAC_OS", "IOS"] if which == "both" else [which]):
        if action == "prepare":
            prepare(platform, version_string, build_no)
        else:
            submit(platform, version_string)
