"""Get an update ready in App Store Connect and send it to App Review, for the Mac, iPhone/iPad, or both.

usage: asc_release.py prepare  <MAC_OS|IOS|both> <version> [build]
       asc_release.py submit   <MAC_OS|IOS|both> <version>
       asc_release.py withdraw <MAC_OS|IOS|both> <version>

withdraw: takes a version that's waiting for or in App Review back out (so a newer build can go instead).
A version that was never released (rejected, withdrawn, or still being prepared) is renamed to <version>
rather than a second one being made, since Apple allows one version in progress at a time.

prepare: makes the new version (once the one before it is approved), fills in What's New, the description,
promotional text, keywords and App Review notes from appstore/<version>/, and picks the build (the newest
valid build of that version, unless a build number is given). The English subtitle comes from
appstore/<version>/subtitle.txt when there is one. Screenshots carry over from the last version, unless
appstore/<version>/screenshots/ has new ones: iphone-*.png (1290 x 2796), ipad-*.png (2048 x 2732) and mac-*.png
(2880 x 1800), which replace that device's English screenshots in file-name order.
Other languages: each folder in appstore/locales/ (zh-Hans, zh-Hant, ja…) is a translated App Store page
(description-mac/ios, promo, keywords, subtitle). prepare adds the language if the app doesn't have it yet and
fills it in. What's New in that language comes from appstore/<version>/<locale>/whats-new-<mac|ios>.txt, else English.
Those pages use the English screenshots.
submit: sends that version to App Review.
"""
import glob, hashlib, os, sys, time
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
        errs = r.json().get("errors", []) if r.content else []
        detail = "; ".join(e.get("detail") or e.get("title", "") for e in errs)
        for e in errs:  # Apple puts the real reasons in meta.associatedErrors
            for where, lst in ((e.get("meta") or {}).get("associatedErrors") or {}).items():
                for x in lst:
                    detail += f" | {where}: {x.get('code', '')} {x.get('detail') or x.get('title', '')}"
        print(f"::error title={method} {path[:70]}::{r.status_code} {detail[:1500]}")
        sys.exit(1)
    return r.json() if r.content else {}


def note(t, m):
    print(f"::notice title={t}::{m}")


LOCALES = sorted(d for d in os.listdir("appstore/locales") if os.path.isdir(f"appstore/locales/{d}")) \
    if os.path.isdir("appstore/locales") else []


def loc_text(locale, version, name):
    for p in (f"appstore/{version}/{locale}/{name}", f"appstore/locales/{locale}/{name}"):
        if os.path.exists(p):
            return open(p).read().strip()
    return None


def soft(fn, title, *a):
    """A translated page that Apple won't take mustn't stop the English release."""
    try:
        return fn(*a)
    except SystemExit:
        print(f"::warning title={title}::Skipped; the English page is unaffected")
        return None


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
    # A version that never went out (rejected or withdrawn) takes the new number instead
    for v in vs:
        if state(v) in EDITABLE:
            old = v["attributes"]["versionString"]
            v = call("PATCH", f"/appStoreVersions/{v['id']}", json={"data": {"type": "appStoreVersions", "id": v["id"],
                     "attributes": {"versionString": version_string}}})["data"]
            note(f"{LABEL[platform]} {version_string}", f"Renamed version {old} to {version_string}")
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
    # What's New is only allowed once an earlier version has been on the App Store
    released = any(state(x) in DONE for x in versions(platform) if x["id"] != v["id"])
    attrs = {
        "whatsNew": text(version_string, f"whats-new-{kind}.txt", f"appstore/{version_string}/whats-new.txt") if released else None,
        "description": text(version_string, f"description-{kind}.txt"),
        "promotionalText": text(version_string, "promo.txt"),
        "keywords": text(version_string, "keywords.txt"),
        # the app's own website
        "supportUrl": "https://readingroomapp.com/support/",
        "marketingUrl": "https://readingroomapp.com/",
    }
    attrs = {k: v_ for k, v_ in attrs.items() if v_}
    locs = call("GET", f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations")["data"]
    if not locs:
        print(f"::error title=Listing::No listing language on {LABEL[platform]} {version_string}.")
        sys.exit(1)
    def attrs_for(locale):
        if locale not in LOCALES:
            return attrs
        t = {
            "whatsNew": (loc_text(locale, version_string, f"whats-new-{kind}.txt") or attrs.get("whatsNew")) if released else None,
            "description": loc_text(locale, version_string, f"description-{kind}.txt"),
            "promotionalText": loc_text(locale, version_string, "promo.txt"),
            "keywords": loc_text(locale, version_string, "keywords.txt"),
        }
        return {**attrs, **{k: v_ for k, v_ in t.items() if v_}}

    for loc in locs:
        locale = loc["attributes"].get("locale")
        if locale in LOCALES:
            soft(call, f"Listing {locale}", "PATCH", f"/appStoreVersionLocalizations/{loc['id']}", json={"data": {
                 "type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": attrs_for(locale)}})
        else:
            call("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", json={"data": {"type": "appStoreVersionLocalizations",
                 "id": loc["id"], "attributes": attrs}})
        note("Listing", f"{locale}: " + ", ".join(sorted(attrs_for(locale))))

    # Translated pages: the language has to exist on the app's info (name, subtitle) before the version can have it
    have = {l["attributes"].get("locale") for l in locs}
    missing = [l for l in LOCALES if l not in have]
    if LOCALES:
        add_languages(missing, version_string)
    for locale in missing:
        out = soft(call, f"Listing {locale}", "POST", "/appStoreVersionLocalizations", json={"data": {
              "type": "appStoreVersionLocalizations", "attributes": {"locale": locale, **attrs_for(locale)},
              "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
        if out:
            note("Listing", f"{locale} added: " + ", ".join(sorted(attrs_for(locale))))

    # The privacy policy link lives on the app's info, which can only change while a version is being prepared
    PRIVACY = "https://readingroomapp.com/privacy/"
    for info in call("GET", f"/apps/{AID}/appInfos")["data"]:
        if info["attributes"].get("appStoreState") in ("READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_INFO"):
            continue
        for il in call("GET", f"/appInfos/{info['id']}/appInfoLocalizations")["data"]:
            sub = text(version_string, "subtitle.txt")
            if sub and il["attributes"].get("locale") == "en-US" and il["attributes"].get("subtitle") != sub:
                if soft(call, "Subtitle", "PATCH", f"/appInfoLocalizations/{il['id']}", json={"data": {"type": "appInfoLocalizations",
                        "id": il["id"], "attributes": {"subtitle": sub}}}) is not None:
                    note("Subtitle", f"en-US: {sub}")
            if il["attributes"].get("privacyPolicyUrl") != PRIVACY:
                try:
                    call("PATCH", f"/appInfoLocalizations/{il['id']}", json={"data": {"type": "appInfoLocalizations", "id": il["id"],
                         "attributes": {"privacyPolicyUrl": PRIVACY}}})
                    note("Privacy policy", f"{il['attributes'].get('locale')}: {PRIVACY}")
                except SystemExit:
                    note("Privacy policy", "Couldn't change it on this version; it stays as it was")

    en = next((l for l in locs if l["attributes"].get("locale") == "en-US"), locs[0])
    screenshots(platform, version_string, en)

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


SHOT_SETS = {"IOS": (("APP_IPHONE_67", "iphone-*.png"), ("APP_IPAD_PRO_3GEN_129", "ipad-*.png")),
             "MAC_OS": (("APP_DESKTOP", "mac-*.png"),)}


def screenshots(platform, version_string, loc):
    """New screenshots in appstore/<version>/screenshots/ replace that device's set. New ones go up first and the old
    ones come off only once all of them are in, so a failed upload never leaves the page without pictures."""
    for kind, pattern in SHOT_SETS[platform]:
        files = sorted(glob.glob(f"appstore/{version_string}/screenshots/{pattern}"))
        if not files:
            continue
        sets = {x["attributes"]["screenshotDisplayType"]: x for x in
                call("GET", f"/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")["data"]}
        st = sets.get(kind) or call("POST", "/appScreenshotSets", json={"data": {"type": "appScreenshotSets",
             "attributes": {"screenshotDisplayType": kind},
             "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"]}}}}})["data"]
        old = [x["id"] for x in call("GET", f"/appScreenshotSets/{st['id']}/appScreenshots")["data"]]
        for f in files:
            data = open(f, "rb").read()
            shot = call("POST", "/appScreenshots", json={"data": {"type": "appScreenshots",
                   "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
                   "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": st["id"]}}}}})["data"]
            for op in shot["attributes"]["uploadOperations"]:
                r = requests.request(op["method"], op["url"], data=data[op["offset"]: op["offset"] + op["length"]],
                                     headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])}, timeout=120)
                if r.status_code >= 300:
                    print(f"::error title=Screenshot {f}::{r.status_code} {r.text[:500]}")
                    sys.exit(1)
            call("PATCH", f"/appScreenshots/{shot['id']}", json={"data": {"type": "appScreenshots", "id": shot["id"],
                 "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
        for sid in old:
            call("DELETE", f"/appScreenshots/{sid}")
        note("Screenshots", f"{kind}: {len(files)} new, {len(old)} old removed")


def add_languages(locales, version_string):
    """Give each translated language its app info (the English name, a translated subtitle, the privacy link)."""
    infos = [i for i in call("GET", f"/apps/{AID}/appInfos")["data"]
             if i["attributes"].get("appStoreState") not in ("READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_INFO")]
    for info in infos:
        ils = call("GET", f"/appInfos/{info['id']}/appInfoLocalizations")["data"]
        by = {il["attributes"].get("locale"): il for il in ils}
        en = by.get("en-US") or (ils[0] if ils else None)
        name = (en or {}).get("attributes", {}).get("name") or "The Reading Room – RSS Reader"
        for locale in LOCALES:
            sub = loc_text(locale, version_string, "subtitle.txt")
            if locale in by:
                if sub and by[locale]["attributes"].get("subtitle") != sub:
                    soft(call, f"Subtitle {locale}", "PATCH", f"/appInfoLocalizations/{by[locale]['id']}", json={"data": {
                         "type": "appInfoLocalizations", "id": by[locale]["id"], "attributes": {"subtitle": sub}}})
                continue
            a = {"locale": locale, "name": name, "privacyPolicyUrl": "https://readingroomapp.com/privacy/"}
            if sub:
                a["subtitle"] = sub
            if soft(call, f"Language {locale}", "POST", "/appInfoLocalizations", json={"data": {"type": "appInfoLocalizations",
                    "attributes": a, "relationships": {"appInfo": {"data": {"type": "appInfos", "id": info["id"]}}}}}):
                note("Language", f"{locale} added to the app ({name})")


def submit(platform, version_string):
    v = next((x for x in versions(platform) if x["attributes"]["versionString"] == version_string), None)
    if not v:
        print(f"::error title=Submit::No {LABEL[platform]} version {version_string}. Run prepare first.")
        sys.exit(1)
    note(f"{LABEL[platform]} {version_string}", f"state {state(v)}")
    b = call("GET", f"/appStoreVersions/{v['id']}/build").get("data")
    if not b:
        print(f"::error title=Build::No build attached to {LABEL[platform]} {version_string}. Run prepare first.")
        sys.exit(1)
    ba = b["attributes"]
    note("Build", f"{ba.get('version')} {ba.get('processingState')} encryption answered: {ba.get('usesNonExemptEncryption')}")
    # The export-compliance question: the app only uses standard HTTPS (exempt). An unanswered build can't be reviewed.
    if ba.get("usesNonExemptEncryption") is None:
        call("PATCH", f"/builds/{b['id']}", json={"data": {"type": "builds", "id": b["id"], "attributes": {"usesNonExemptEncryption": False}}})
        note("Export compliance", "Answered: uses only standard (exempt) encryption")
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


def withdraw(platform, version_string):
    subs = call("GET", "/reviewSubmissions", params={"filter[app]": AID, "filter[platform]": platform, "limit": 20})["data"]
    live = [s for s in subs if s["attributes"].get("state") in ("WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES")]
    if not live:
        note(f"{LABEL[platform]}", "Nothing waiting for or in review")
        return
    for sub in live:
        out = call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"],
                   "attributes": {"canceled": True}}})
        note(f"Withdrew {LABEL[platform]}", f"{sub['attributes'].get('state')} → {out['data']['attributes'].get('state')}")


if __name__ == "__main__":
    action, which, version_string = sys.argv[1], sys.argv[2], sys.argv[3]
    build_no = sys.argv[4] if len(sys.argv) > 4 else ""
    for platform in (["MAC_OS", "IOS"] if which == "both" else [which]):
        if action == "prepare":
            prepare(platform, version_string, build_no)
        elif action == "withdraw":
            withdraw(platform, version_string)
        else:
            submit(platform, version_string)
