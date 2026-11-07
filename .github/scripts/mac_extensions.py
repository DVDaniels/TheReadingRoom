"""The Mac's Share menu extension and widgets: profiles, an Xcode project, and the files to sign them.

1. Registers com.daviddaniels.readingroom.macshare and .macwidgets (macOS bundle IDs) if needed and gets a
   Mac App Store profile for each, made with the certificate named by APP_IDENTITY.
2. Checks the app's own profile (src-tauri/embedded.provisionprofile) allows the shared keychain group,
   since the app would refuse to open if it didn't.
3. Writes an XcodeGen project in $RUNNER_TEMP/macext, with the plists and entitlements filled in.

The workflow then builds the two .appex bundles, signs them and puts them inside the app.
"""
import base64, json, os, plistlib, re, shutil, subprocess, sys, tempfile, time
import jwt, requests, yaml
from cryptography import x509
from cryptography.hazmat.primitives import serialization

API = "https://api.appstoreconnect.apple.com/v1"
ROOT = os.getcwd()
TEAM = os.environ["TEAM_ID"].strip()
BUILD = os.environ["BUILD_NO"]
VERSION = json.load(open(os.path.join(ROOT, "src-tauri/tauri.conf.json")))["version"]
BUNDLE = "com.daviddaniels.readingroom"
OUT = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "macext")
EXT = {"share": f"{BUNDLE}.macshare", "widgets": f"{BUNDLE}.macwidgets"}


def note(t, m):
    print(f"::notice title={t}::{m}")


def fail(t, m):
    print(f"::error title={t}::{m}")
    sys.exit(1)


def token():
    key = open(os.path.expanduser(f"~/private_keys/AuthKey_{os.environ['API_KEY_ID']}.p8")).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["API_ISSUER"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["API_KEY_ID"], "typ": "JWT"})


def api(method, path, **kw):
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token()}"}, timeout=60, **kw)
    if r.status_code >= 400:
        detail = "; ".join(e.get("detail", e.get("title", "")) for e in r.json().get("errors", [])) if r.content else ""
        fail("App Store Connect API", f"{method} {path} → {r.status_code}: {detail[:900]}")
    return r.json() if r.content else {}


def signing_cert_id():
    """The App Store Connect id of the certificate APP_IDENTITY names (found by serial in APPLE_APPSTORE_CERTS)."""
    p12 = base64.b64decode(os.environ["APPSTORE_CERTS"])
    with tempfile.NamedTemporaryFile(suffix=".p12", delete=False) as f:
        f.write(p12)
    out = subprocess.run(["/usr/bin/openssl", "pkcs12", "-in", f.name, "-nokeys", "-passin", f"pass:{os.environ.get('CERT_PASSWORD', '')}"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        out = subprocess.run(["/usr/bin/openssl", "pkcs12", "-legacy", "-in", f.name, "-nokeys", "-passin", f"pass:{os.environ.get('CERT_PASSWORD', '')}"],
                             capture_output=True, text=True)
    want = os.environ["APP_IDENTITY"].strip()
    for pem in re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", out.stdout, re.S):
        c = x509.load_pem_x509_certificate(pem.encode())
        cn = c.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
        if cn == want or want in cn:
            serial = f"{c.serial_number:X}".lstrip("0")
            for cert in api("GET", "/certificates", params={"limit": 200})["data"]:
                if cert["attributes"].get("serialNumber", "").upper().lstrip("0") == serial:
                    note("Certificate", f"{cn}")
                    return cert["id"]
            fail("Certificate", f"Apple doesn't list {cn} (serial {serial}); it may have been revoked.")
    fail("Certificate", f"No certificate named {want} in APPLE_APPSTORE_CERTS.")


def ensure_bundle(identifier, name):
    found = [b for b in api("GET", "/bundleIds", params={"filter[identifier]": identifier, "limit": 20})["data"]
             if b["attributes"]["identifier"] == identifier]
    if found:
        return found[0]
    b = api("POST", "/bundleIds", json={"data": {"type": "bundleIds", "attributes": {
        "identifier": identifier, "name": name, "platform": "MAC_OS"}}})["data"]
    note("Bundle ID", f"Registered {identifier}")
    return b


def profile_for(bundle, cert_id, name):
    profiles = api("GET", f"/bundleIds/{bundle['id']}/profiles", params={"limit": 50})["data"]
    for p in profiles:
        a = p["attributes"]
        if a["profileType"] == "MAC_APP_STORE" and a["profileState"] == "ACTIVE":
            if any(c["id"] == cert_id for c in api("GET", f"/profiles/{p['id']}/certificates")["data"]):
                note("Profile", f"Using existing profile {a['name']}")
                return api("GET", f"/profiles/{p['id']}")["data"]
    p = api("POST", "/profiles", json={"data": {
        "type": "profiles",
        "attributes": {"name": f"{name} {time.strftime('%Y-%m-%d %H%M')}", "profileType": "MAC_APP_STORE"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
        }}})["data"]
    note("Profile", f"Created {p['attributes']['name']}")
    return p


def profile_entitlements(data):
    out = subprocess.run(["security", "cms", "-D"], input=data, capture_output=True)
    return plistlib.loads(out.stdout).get("Entitlements", {}) if out.returncode == 0 else {}


def main():
    os.makedirs(OUT, exist_ok=True)

    # the app's own profile has to allow the shared keychain group, or the app won't open
    app_ent = profile_entitlements(open(os.path.join(ROOT, "src-tauri/embedded.provisionprofile"), "rb").read())
    groups = app_ent.get("keychain-access-groups", [])
    shared = f"{TEAM}.{BUNDLE}.shared"
    if not any(g == shared or (g.endswith(".*") and shared.startswith(g[:-1])) for g in groups):
        fail("Keychain sharing", f"The app's profile doesn't allow {shared} (it allows {groups or 'no keychain groups'}).")
    note("Keychain sharing", f"The app's profile allows {groups}")

    cert_id = signing_cert_id()
    for kind, name in (("share", "The Reading Room Mac Share"), ("widgets", "The Reading Room Mac Widgets")):
        p = profile_for(ensure_bundle(EXT[kind], name), cert_id, f"{name} App Store")
        open(os.path.join(OUT, f"{kind}.provisionprofile"), "wb").write(base64.b64decode(p["attributes"]["profileContent"]))

    # sources with the version, build and team filled in
    src = os.path.join(OUT, "src")
    shutil.rmtree(src, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, "src-tauri/mac-ext"), src)
    shutil.copytree(os.path.join(ROOT, "src-tauri/ios-ext/Shared"), os.path.join(src, "Shared"))
    shutil.copy(os.path.join(ROOT, "src-tauri/ios-ext/Widgets/Widgets.swift"), os.path.join(src, "Widgets/Widgets.swift"))
    for d, _, files in os.walk(src):
        for f in files:
            if f.endswith((".plist", ".entitlements")):
                p = os.path.join(d, f)
                open(p, "w").write(open(p).read().replace("__VERSION__", VERSION).replace("__BUILD__", BUILD).replace("__TEAM__", TEAM))

    def target(folder, bundle, deployment, frameworks):
        return {
            "type": "app-extension", "platform": "macOS", "deploymentTarget": deployment,
            "sources": [{"path": f"src/{folder}", "excludes": ["*.plist", "*.entitlements"]}, {"path": "src/Shared"}],
            "settings": {"base": {
                "PRODUCT_BUNDLE_IDENTIFIER": bundle, "INFOPLIST_FILE": f"src/{folder}/Info.plist", "GENERATE_INFOPLIST_FILE": "NO",
                "SWIFT_VERSION": "5.0", "CODE_SIGNING_ALLOWED": "NO", "CODE_SIGN_IDENTITY": "", "MACOSX_DEPLOYMENT_TARGET": deployment,
                "ARCHS": "arm64 x86_64", "ONLY_ACTIVE_ARCH": "NO", "APPLICATION_EXTENSION_API_ONLY": "YES",
                "MARKETING_VERSION": VERSION, "CURRENT_PROJECT_VERSION": BUILD, "DEVELOPMENT_TEAM": TEAM,
            }},
            "dependencies": [{"sdk": f} for f in frameworks],
        }

    spec = {"name": "ReadingRoomMacExtensions", "options": {"bundleIdPrefix": BUNDLE},
            "targets": {"ReadingRoomMacShare": target("Share", EXT["share"], "12.0", ["AppKit.framework", "Security.framework"]),
                        "ReadingRoomMacWidgets": target("Widgets", EXT["widgets"], "14.0", ["WidgetKit.framework", "SwiftUI.framework", "Security.framework"])}}
    yaml.safe_dump(spec, open(os.path.join(OUT, "project.yml"), "w"), sort_keys=False)
    note("Extensions", f"Project ready in {OUT} (version {VERSION}, build {BUILD})")


if __name__ == "__main__":
    main()
