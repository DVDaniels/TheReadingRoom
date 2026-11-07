"""Add the Share menu extension and the Home Screen widgets to the Xcode project Tauri made.

Run after `tauri ios init`, before the Info.plist touch-ups: it edits project.yml, copies
src-tauri/ios-ext into the project, signs every target by hand with the profiles ios_signing.py
installed, and runs xcodegen again.
"""
import os, re, shutil, subprocess, sys, json
import yaml

ROOT = os.getcwd()
APPLE = os.path.join(ROOT, "src-tauri/gen/apple")
TEAM = os.environ["APPLE_DEVELOPMENT_TEAM"].strip()
BUILD = os.environ["BUILD_NO"]
VERSION = json.load(open(os.path.join(ROOT, "src-tauri/tauri.conf.json")))["version"]
BUNDLE = "com.daviddaniels.readingroom"
GROUP = f"{TEAM}.{BUNDLE}.shared"
PROFILES = {"main": os.environ["RR_PROFILE_MAIN"], "share": os.environ["RR_PROFILE_SHARE"], "widgets": os.environ["RR_PROFILE_WIDGETS"]}


def note(t, m):
    print(f"::notice title={t}::{m}")


def signing(profile):
    return {"CODE_SIGN_STYLE": "Manual", "CODE_SIGN_IDENTITY": "Apple Distribution", "CODE_SIGN_IDENTITY[sdk=iphoneos*]": "Apple Distribution",
            "PROVISIONING_PROFILE_SPECIFIER": profile, "PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]": profile, "DEVELOPMENT_TEAM": TEAM}


def main():
    # the Swift sources, with the version, build and team filled in
    ext = os.path.join(APPLE, "ext")
    shutil.rmtree(ext, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, "src-tauri/ios-ext"), ext)
    for d, _, files in os.walk(ext):
        for f in files:
            if f.endswith(".plist"):
                p = os.path.join(d, f)
                s = open(p).read().replace("__VERSION__", VERSION).replace("__BUILD__", BUILD).replace("__TEAM__", TEAM)
                open(p, "w").write(s)

    spec_path = os.path.join(APPLE, "project.yml")
    spec = yaml.safe_load(open(spec_path))
    targets = spec["targets"]
    app_name = next(k for k in targets if k.endswith("_iOS"))
    app = targets[app_name]

    # the app: signed by hand, allowed into the shared keychain group, and told its name
    app.setdefault("settings", {}).setdefault("base", {}).update(signing(PROFILES["main"]))
    ent = app.setdefault("entitlements", {"path": f"{app_name}/{app_name}.entitlements"})
    ent.setdefault("properties", {})["keychain-access-groups"] = [f"$(AppIdentifierPrefix){BUNDLE}", f"$(AppIdentifierPrefix){BUNDLE}.shared"]
    app.setdefault("info", {}).setdefault("properties", {})["ReadingRoomKeychainGroup"] = GROUP
    deps = app.setdefault("dependencies", [])
    for t in ("ReadingRoomShare", "ReadingRoomWidgets"):
        if not any(d.get("target") == t for d in deps):
            deps.append({"target": t, "embed": True, "codeSign": True})

    def extension(folder, bundle, profile, deployment, frameworks):
        base = {
            "PRODUCT_BUNDLE_IDENTIFIER": bundle, "INFOPLIST_FILE": f"ext/{folder}/Info.plist",
            "CODE_SIGN_ENTITLEMENTS": f"ext/{folder}/{folder}.entitlements", "GENERATE_INFOPLIST_FILE": "NO",
            "SWIFT_VERSION": "5.0", "TARGETED_DEVICE_FAMILY": "1,2", "SKIP_INSTALL": "YES",
            "APPLICATION_EXTENSION_API_ONLY": "YES", "IPHONEOS_DEPLOYMENT_TARGET": deployment,
            "MARKETING_VERSION": VERSION, "CURRENT_PROJECT_VERSION": BUILD, "ENABLE_BITCODE": "NO",
        }
        base.update(signing(profile))
        return {
            "type": "app-extension", "platform": "iOS", "deploymentTarget": deployment,
            "sources": [{"path": f"ext/{folder}", "excludes": ["*.plist", "*.entitlements"]}, {"path": "ext/Shared"}],
            "settings": {"base": base},
            "dependencies": [{"sdk": f} for f in frameworks],
        }

    targets["ReadingRoomShare"] = extension("Share", f"{BUNDLE}.share", PROFILES["share"], "15.0", ["UIKit.framework", "Security.framework"])
    targets["ReadingRoomWidgets"] = extension("Widgets", f"{BUNDLE}.widgets", PROFILES["widgets"], "17.0", ["WidgetKit.framework", "SwiftUI.framework", "Security.framework"])

    yaml.safe_dump(spec, open(spec_path, "w"), sort_keys=False, width=100000)
    out = subprocess.run(["xcodegen", "generate", "--spec", spec_path, "--project", APPLE], capture_output=True, text=True)
    if out.returncode != 0:
        print(f"::error title=xcodegen::{(out.stdout + out.stderr)[-3000:]}".replace("\n", " "))
        sys.exit(1)
    note("Extensions", f"Added the Share menu extension and widgets to {app_name} (team {TEAM}, build {BUILD})")

    # export options for all three bundles (Tauri's own only names the app)
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>signingStyle</key><string>manual</string>
<key>teamID</key><string>{TEAM}</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>provisioningProfiles</key><dict>
<key>{BUNDLE}</key><string>{PROFILES['main']}</string>
<key>{BUNDLE}.share</key><string>{PROFILES['share']}</string>
<key>{BUNDLE}.widgets</key><string>{PROFILES['widgets']}</string>
</dict></dict></plist>
"""
    open(os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "RRExportOptions.plist"), "w").write(plist)


if __name__ == "__main__":
    main()
