"""Product page tests (Apple's "Product Page Optimization") for the iPhone/iPad store page.

    python asc_ppo.py create <name> <folder> [traffic %]   make the test with one treatment, screenshots from <folder>
    python asc_ppo.py submit <name>                        send the treatment to App Review
    python asc_ppo.py start <name>                         start showing it to customers (once Apple approved it)
    python asc_ppo.py stop <name>                          end the test
    python asc_ppo.py status                               list tests and their state

<folder> holds iphone-*.png (1290 x 2796) and ipad-*.png (2732 x 2048 or 2048 x 2732), in file-name order.
The treatment gets the same screenshots in every language the live page has. Tests run on iPhone/iPad only.
"""
import hashlib, glob, os, sys
import requests
sys.path.insert(0, os.path.dirname(__file__))
import asc_release as R

V2 = "https://api.appstoreconnect.apple.com/v2"


def call2(method, path, **kw):
    r = requests.request(method, V2 + path, headers={"Authorization": f"Bearer {R.token()}"}, timeout=120, **kw)
    if r.status_code >= 400:
        errs = r.json().get("errors", []) if r.content else []
        print(f"::error title={method} {path[:70]}::{r.status_code} " + "; ".join(e.get("detail") or e.get("title", "") for e in errs)[:1500])
        sys.exit(1)
    return r.json() if r.content else {}


def tests():
    return R.call("GET", f"/apps/{R.AID}/appStoreVersionExperimentsV2", params={"limit": 50})["data"]


def find(name):
    t = next((x for x in tests() if x["attributes"]["name"] == name), None)
    if not t:
        print(f"::error title=Test::No test named {name}. Run create first.")
        sys.exit(1)
    return t


def live_locales():
    v = next(x for x in R.versions("IOS") if R.state(x) in R.DONE)
    return [x["attributes"]["locale"] for x in R.call("GET", f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations")["data"]]


def upload(set_id, files):
    for f in files:
        data = open(f, "rb").read()
        shot = R.call("POST", "/appScreenshots", json={"data": {"type": "appScreenshots",
               "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
               "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
        for op in shot["attributes"]["uploadOperations"]:
            r = requests.request(op["method"], op["url"], data=data[op["offset"]: op["offset"] + op["length"]],
                                 headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])}, timeout=120)
            if r.status_code >= 300:
                print(f"::error title=Screenshot {f}::{r.status_code} {r.text[:500]}")
                sys.exit(1)
        R.call("PATCH", f"/appScreenshots/{shot['id']}", json={"data": {"type": "appScreenshots", "id": shot["id"],
               "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})


def create(name, folder, traffic=50):
    t = next((x for x in tests() if x["attributes"]["name"] == name), None)
    if t:
        R.note("Test", f"{name} already exists ({t['attributes'].get('state')}); filling in what's missing")
    else:
        t = call2("POST", "/appStoreVersionExperiments", json={"data": {"type": "appStoreVersionExperiments",
              "attributes": {"name": name, "trafficProportion": int(traffic), "platform": "IOS"},
              "relationships": {"app": {"data": {"type": "apps", "id": R.AID}}}}})["data"]
        R.note("Test", f"made {name}, {traffic}% of visitors see the new page")
    trs = R.call("GET", f"/appStoreVersionExperimentsV2/{t['id']}/appStoreVersionExperimentTreatments")["data"]
    tr = trs[0] if trs else R.call("POST", "/appStoreVersionExperimentTreatments", json={"data": {
         "type": "appStoreVersionExperimentTreatments", "attributes": {"name": "B"},
         "relationships": {"appStoreVersionExperimentV2": {"data": {"type": "appStoreVersionExperiments", "id": t["id"]}}}}})["data"]
    have = {x["attributes"]["locale"]: x for x in
            R.call("GET", f"/appStoreVersionExperimentTreatments/{tr['id']}/appStoreVersionExperimentTreatmentLocalizations")["data"]}
    for locale in live_locales():
        loc = have.get(locale) or R.call("POST", "/appStoreVersionExperimentTreatmentLocalizations", json={"data": {
              "type": "appStoreVersionExperimentTreatmentLocalizations", "attributes": {"locale": locale},
              "relationships": {"appStoreVersionExperimentTreatment": {"data": {"type": "appStoreVersionExperimentTreatments", "id": tr["id"]}}}}})["data"]
        sets = {x["attributes"]["screenshotDisplayType"]: x for x in
                R.call("GET", f"/appStoreVersionExperimentTreatmentLocalizations/{loc['id']}/appScreenshotSets")["data"]}
        for kind, pattern in R.SHOT_SETS["IOS"]:
            files = sorted(glob.glob(os.path.join(folder, pattern)))
            st = sets.get(kind) or R.call("POST", "/appScreenshotSets", json={"data": {"type": "appScreenshotSets",
                 "attributes": {"screenshotDisplayType": kind},
                 "relationships": {"appStoreVersionExperimentTreatmentLocalization": {"data": {
                     "type": "appStoreVersionExperimentTreatmentLocalizations", "id": loc["id"]}}}}})["data"]
            old = R.call("GET", f"/appScreenshotSets/{st['id']}/appScreenshots")["data"]
            if len(old) == len(files):
                continue
            for x in old:
                R.call("DELETE", f"/appScreenshots/{x['id']}")
            upload(st["id"], files)
            R.note(f"Screenshots {locale}", f"{kind}: {len(files)}")


def submit(name):
    t = find(name)
    subs = R.call("GET", "/reviewSubmissions", params={"filter[app]": R.AID, "filter[platform]": "IOS", "limit": 20})["data"]
    sub = next((s for s in subs if s["attributes"].get("state") in ("READY_FOR_REVIEW", "UNRESOLVED_ISSUES")), None) or \
        R.call("POST", "/reviewSubmissions", json={"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
               "relationships": {"app": {"data": {"type": "apps", "id": R.AID}}}}})["data"]
    if not R.call("GET", f"/reviewSubmissions/{sub['id']}/items")["data"]:
        R.call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems",
               "relationships": {"reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                                 "appStoreVersionExperimentV2": {"data": {"type": "appStoreVersionExperiments", "id": t["id"]}}}}})
    out = R.call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"],
                 "attributes": {"submitted": True}}})
    R.note(f"Submitted {name}", out["data"]["attributes"].get("state"))


def started(name, on):
    t = find(name)
    out = call2("PATCH", f"/appStoreVersionExperiments/{t['id']}", json={"data": {"type": "appStoreVersionExperiments",
                "id": t["id"], "attributes": {"started": on}}})
    R.note(name, f"{'started' if on else 'stopped'}: {out['data']['attributes'].get('state')}")


def status():
    for x in tests():
        a = x["attributes"]
        R.note(f"Test {a['name']}", f"{a.get('state')} · {a.get('trafficProportion')}% · started {a.get('startDate') or '-'} · ends {a.get('endDate') or '-'}")
    if not tests():
        R.note("Tests", "none")


if __name__ == "__main__":
    act = sys.argv[1]
    if act == "create":
        create(sys.argv[2], sys.argv[3], *(sys.argv[4:5]))
    elif act == "submit":
        submit(sys.argv[2])
    elif act in ("start", "stop"):
        started(sys.argv[2], act == "start")
    else:
        status()
