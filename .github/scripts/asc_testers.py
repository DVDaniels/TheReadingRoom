"""Hand a build to the external TestFlight testers (the public-link group).

Waits until Apple has processed the build, then: adds it to the group, sets its "What to Test"
text (appstore/<version>/testflight.txt), turns on "Automatically notify testers", and submits it
for TestFlight App Review (the first build of a version gets a full review, later ones usually
pass at once). Usage:

    python asc_testers.py IOS|MAC_OS <build number or "latest"> [group name]

Needs API_KEY_ID, API_ISSUER and the key in ~/private_keys (as the other scripts).
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = "com.daviddaniels.readingroom"
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def token():
    key = open(os.path.expanduser(f"~/private_keys/AuthKey_{os.environ['API_KEY_ID']}.p8")).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["API_ISSUER"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["API_KEY_ID"], "typ": "JWT"})


def call(method, path, body=None, **params):
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
                         params=params or None, data=json.dumps(body) if body is not None else None, timeout=60)
    return r.status_code, (r.json() if r.text else {})


def note(title, msg, kind="notice"):
    print(f"::{kind} title={title}::{msg}")


def problem(res):
    errs = res.get("errors") or []
    return "; ".join(f"{e.get('code', '')}: {e.get('detail') or e.get('title', '')}" for e in errs)[:600]


def main():
    platform, build_no = sys.argv[1], sys.argv[2]
    group_name = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("TESTER_GROUP", "RSS Testers")
    label = "Mac" if platform == "MAC_OS" else "iPhone/iPad"
    version = json.load(open(os.path.join(ROOT, "src-tauri", "tauri.conf.json")))["version"]

    _, apps = call("GET", "/apps", **{"filter[bundleId]": BUNDLE})
    aid = apps["data"][0]["id"]

    # The build: wait (up to 45 minutes) until Apple has processed it
    build = None
    for _ in range(90):
        params = {"filter[app]": aid, "filter[preReleaseVersion.platform]": platform, "filter[preReleaseVersion.version]": version,
                  "sort": "-uploadedDate", "limit": 1}
        if build_no != "latest":
            params["filter[version]"] = build_no
        _, res = call("GET", "/builds", **params)
        if res.get("data"):
            build = res["data"][0]
            state = build["attributes"].get("processingState")
            if state == "VALID":
                break
            if state in ("FAILED", "INVALID"):
                note(f"{label} build {build_no}", f"Apple couldn't process it ({state}); not sent to testers.", "error")
                sys.exit(1)
        time.sleep(30)
    else:
        note(f"{label} build {build_no}", "Apple hasn't finished processing it after 45 minutes. Run 'Send to testers' later.", "warning")
        return
    bid, number = build["id"], build["attributes"]["version"]
    name = f"{label} build {number}"

    # The external group (the one with the public link)
    _, groups = call("GET", f"/apps/{aid}/betaGroups", limit=50)
    group = next((g for g in groups.get("data", []) if g["attributes"]["name"] == group_name and not g["attributes"].get("isInternalGroup")), None)
    if not group:
        note(name, f"No external TestFlight group called '{group_name}'.", "error")
        sys.exit(1)

    # What to Test
    path = os.path.join(ROOT, "appstore", version, "testflight.txt")
    if os.path.exists(path):
        text = open(path).read().strip()[:4000]
        _, locs = call("GET", f"/builds/{bid}/betaBuildLocalizations")
        mine = next((l for l in locs.get("data", []) if l["attributes"].get("locale") == "en-US"), None)
        if mine:
            st, res = call("PATCH", f"/betaBuildLocalizations/{mine['id']}",
                           {"data": {"type": "betaBuildLocalizations", "id": mine["id"], "attributes": {"whatsNew": text}}})
        else:
            st, res = call("POST", "/betaBuildLocalizations", {"data": {"type": "betaBuildLocalizations",
                           "attributes": {"locale": "en-US", "whatsNew": text},
                           "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
        if st >= 400:
            note(name, f"Couldn't set What to Test ({st} {problem(res)})", "warning")
    else:
        note(name, f"No appstore/{version}/testflight.txt, so What to Test was left as it was.", "warning")

    # Tell testers as soon as it's approved
    _, detail = call("GET", f"/builds/{bid}/buildBetaDetail")
    if detail.get("data"):
        did = detail["data"]["id"]
        call("PATCH", f"/buildBetaDetails/{did}", {"data": {"type": "buildBetaDetails", "id": did, "attributes": {"autoNotifyEnabled": True}}})

    # Into the group
    st, res = call("POST", f"/betaGroups/{group['id']}/relationships/builds", {"data": [{"type": "builds", "id": bid}]})
    if st >= 400:
        note(name, f"Couldn't add it to {group_name} ({st} {problem(res)})", "error")
        sys.exit(1)

    # TestFlight App Review
    st, res = call("POST", "/betaAppReviewSubmissions", {"data": {"type": "betaAppReviewSubmissions",
                   "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
    if st < 400:
        state = res.get("data", {}).get("attributes", {}).get("betaReviewState", "submitted")
        note(name, f"Added to {group_name} and sent to TestFlight review ({state}). Testers are told when it's approved.")
    else:
        why = problem(res)
        if "already" in why.lower() or "ANOTHER_BUILD" in why or "review" in why.lower():
            note(name, f"Added to {group_name}, but Apple is still reviewing an earlier {label} build, so this one can't go in yet. "
                       f"When that review is done, run 'Send to testers' for build {number}. ({why})", "warning")
        else:
            note(name, f"Added to {group_name}; sending it for review didn't work ({st} {why}). Run 'Send to testers' again later.", "warning")


if __name__ == "__main__":
    main()
