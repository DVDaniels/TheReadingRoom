"""Expire TestFlight builds, so they leave TestFlight for everyone (this can't be undone). Usage:

    python asc_expire.py IOS|MAC_OS <version> [build numbers, comma-separated, or "all"]

Used Nov 26 to clear the 1.3.0 (YouTube) builds, which sat above newer 1.2.11 builds in TestFlight
because TestFlight lists the highest version first; YouTube builds use the main version since then.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from asc_testers import call, note, problem, BUNDLE


def main():
    platform, version = sys.argv[1], sys.argv[2]
    which = (sys.argv[3] if len(sys.argv) > 3 else "all").strip()
    keep = None if which == "all" else {w.strip() for w in which.split(",") if w.strip()}
    label = "Mac" if platform == "MAC_OS" else "iPhone/iPad"
    _, apps = call("GET", "/apps", **{"filter[bundleId]": BUNDLE})
    aid = apps["data"][0]["id"]
    _, res = call("GET", "/builds", **{"filter[app]": aid, "filter[preReleaseVersion.platform]": platform,
                                        "filter[preReleaseVersion.version]": version, "filter[expired]": "false", "limit": 200})
    builds = [b for b in res.get("data", []) if keep is None or b["attributes"]["version"] in keep]
    if not builds:
        note(f"{label} {version}", "No builds to expire.")
        return
    for b in builds:
        st, r = call("PATCH", f"/builds/{b['id']}", {"data": {"type": "builds", "id": b["id"], "attributes": {"expired": True}}})
        n = b["attributes"]["version"]
        if st >= 400:
            note(f"{label} {version} build {n}", f"Couldn't expire it ({st} {problem(r)})", "warning")
        else:
            note(f"{label} {version} build {n}", "Expired")


if __name__ == "__main__":
    main()
