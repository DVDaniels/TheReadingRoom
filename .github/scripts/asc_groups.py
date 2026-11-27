"""Read-only: every TestFlight group of the app, its testers (count, and internal testers' names) and the
builds it can see (newest 12), with each build's internal and external state. Usage: python asc_groups.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from asc_testers import call, note, BUNDLE


def main():
    _, apps = call("GET", "/apps", **{"filter[bundleId]": BUNDLE})
    aid = apps["data"][0]["id"]
    _, groups = call("GET", f"/apps/{aid}/betaGroups", limit=50)
    for g in groups.get("data", []):
        a = g["attributes"]
        kind = "internal" if a.get("isInternalGroup") else "external"
        _, t = call("GET", f"/betaGroups/{g['id']}/betaTesters", limit=50)
        testers = t.get("data", [])
        who = ", ".join(f"{x['attributes'].get('firstName') or ''} {x['attributes'].get('lastName') or ''}".strip() or "(no name)" for x in testers[:10]) if kind == "internal" else f"{len(testers)} testers"
        note(f"Group {a.get('name')}", f"{kind}; automatic distribution={a.get('hasAccessToAllBuilds')}; testers: {who}")
        _, b = call("GET", f"/betaGroups/{g['id']}/builds", limit=50)
        rows = sorted(b.get("data", []), key=lambda x: x["attributes"].get("uploadedDate", ""), reverse=True)[:12]
        for x in rows:
            ba = x["attributes"]
            _, d = call("GET", f"/builds/{x['id']}/buildBetaDetail")
            dd = d.get("data", {}).get("attributes", {})
            _, v = call("GET", f"/builds/{x['id']}/preReleaseVersion")
            va = v.get("data", {}).get("attributes", {})
            note(f"  {a.get('name')} build {ba.get('version')}", f"{va.get('platform')} {va.get('version')} expired={ba.get('expired')} internal={dd.get('internalBuildState')} external={dd.get('externalBuildState')}")
    # the newest builds overall, whatever group
    _, res = call("GET", "/builds", **{"filter[app]": aid, "sort": "-uploadedDate", "limit": 8, "include": "preReleaseVersion,buildBetaDetail"})
    inc = {(i["type"], i["id"]): i["attributes"] for i in res.get("included", [])}
    for x in res.get("data", []):
        r = x["relationships"]
        v = inc.get(("preReleaseVersions", (r.get("preReleaseVersion", {}).get("data") or {}).get("id")), {})
        d = inc.get(("buildBetaDetails", (r.get("buildBetaDetail", {}).get("data") or {}).get("id")), {})
        note(f"Build {x['attributes'].get('version')}", f"{v.get('platform')} {v.get('version')} {x['attributes'].get('processingState')} expired={x['attributes'].get('expired')} internal={d.get('internalBuildState')} external={d.get('externalBuildState')}")


if __name__ == "__main__":
    main()
