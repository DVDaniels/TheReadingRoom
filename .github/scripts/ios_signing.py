"""Prepare iPhone/iPad signing on the GitHub Mac, using what the Mac App Store build already has.

- Takes the "Apple Distribution" identity out of APPLE_APPSTORE_CERTS (that certificate signs iOS apps too).
- Finds or creates an "App Store" provisioning profile for the app through the App Store Connect API.
- Does the same for the Share menu extension and the widgets, installs all three profiles and the identity
  in a keychain of its own, and writes the profile UUIDs (RR_PROFILE_*) to $GITHUB_ENV.

Messages are printed as GitHub annotations, since the job's log can't always be read.
"""
import base64, os, re, subprocess, sys, tempfile, time, uuid
import jwt, requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = os.environ.get("BUNDLE_ID", "com.daviddaniels.readingroom")


def note(title, msg):
    print(f"::notice title={title}::{msg}")


def fail(title, msg):
    print(f"::error title={title}::{msg}")
    sys.exit(1)


def distribution_identity():
    """Return (key, cert) for the Apple Distribution certificate inside the App Store .p12."""
    p12 = base64.b64decode(os.environ["APPSTORE_CERTS"])
    pw = os.environ.get("CERT_PASSWORD", "")
    with tempfile.NamedTemporaryFile(suffix=".p12", delete=False) as f:
        f.write(p12)
    out = subprocess.run(["/usr/bin/openssl", "pkcs12", "-in", f.name, "-nodes", "-passin", f"pass:{pw}"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        fail("Certificate", "Couldn't open APPLE_APPSTORE_CERTS with APPLE_CERT_PASSWORD: " + out.stderr[-400:])
    # Split into blocks, each with its bag attributes, and pair keys with certificates by localKeyID.
    keys, certs = {}, {}
    for m in re.finditer(r"Bag Attributes(.*?)(-----BEGIN ([A-Z ]+)-----.*?-----END \3-----)", out.stdout, re.S):
        attrs, pem, kind = m.group(1), m.group(2), m.group(3)
        kid = re.search(r"localKeyID:\s*([0-9A-F ]+)", attrs)
        kid = kid.group(1).replace(" ", "") if kid else ""
        if "PRIVATE KEY" in kind:
            keys[kid] = serialization.load_pem_private_key(pem.encode(), None)
        elif kind == "CERTIFICATE":
            certs[kid] = x509.load_pem_x509_certificate(pem.encode())
    for kid, cert in certs.items():
        cn = cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
        if cn.startswith(("Apple Distribution", "iPhone Distribution")) and kid in keys:
            note("Certificate", f"Using {cn} (serial {cert.serial_number:X})")
            return keys[kid], cert
    names = [c.subject.rfc4514_string() for c in certs.values()]
    fail("Certificate", "No Apple Distribution certificate with its key in APPLE_APPSTORE_CERTS. Found: " + "; ".join(names))


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


def ensure_bundle(identifier, name):
    found = api("GET", "/bundleIds", params={"filter[identifier]": identifier, "limit": 20})["data"]
    found = [b for b in found if b["attributes"]["identifier"] == identifier]
    if found:
        return found[0]
    b = api("POST", "/bundleIds", json={"data": {"type": "bundleIds", "attributes": {
        "identifier": identifier, "name": name, "platform": "IOS"}}})["data"]
    note("Bundle ID", f"Registered {identifier}")
    return b


def profile_for(bundle, cert_id, name):
    """An active App Store profile for this bundle that includes our certificate (made if needed)."""
    profiles = api("GET", f"/bundleIds/{bundle['id']}/profiles", params={"limit": 50})["data"]
    usable = [p for p in profiles if p["attributes"]["profileType"] == "IOS_APP_STORE" and p["attributes"]["profileState"] == "ACTIVE"]
    for p in usable:
        certs = api("GET", f"/profiles/{p['id']}/certificates")["data"]
        if any(c["id"] == cert_id for c in certs):
            note("Profile", f"Using existing profile {p['attributes']['name']}")
            return api("GET", f"/profiles/{p['id']}")["data"]
    p = api("POST", "/profiles", json={"data": {
        "type": "profiles",
        "attributes": {"name": f"{name} {time.strftime('%Y-%m-%d %H%M')}", "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
        }}})["data"]
    note("Profile", f"Created {p['attributes']['name']}")
    return p


def install_profile(p):
    """Put a profile where Xcode looks for it; returns its UUID."""
    data = base64.b64decode(p["attributes"]["profileContent"])
    uid = p["attributes"].get("uuid")
    if not uid:
        m = re.search(rb"<key>UUID</key>\s*<string>([^<]+)</string>", data)
        uid = m.group(1).decode()
    for d in ("~/Library/MobileDevice/Provisioning Profiles", "~/Library/Developer/Xcode/UserData/Provisioning Profiles"):
        d = os.path.expanduser(d)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, f"{uid}.mobileprovision"), "wb").write(data)
    return uid


def install_identity(key, cert):
    """The Apple Distribution identity in a keychain of our own, kept for the whole job (archive and export)."""
    pw = uuid.uuid4().hex
    print(f"::add-mask::{pw}")
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(pw.encode()))
    p12 = pkcs12.serialize_key_and_certificates(b"Apple Distribution", key, cert, None, enc)
    path = os.path.join(tempfile.mkdtemp(), "dist.p12")
    open(path, "wb").write(p12)
    kc = os.path.expanduser("~/Library/Keychains/rr-signing.keychain-db")
    kpw = uuid.uuid4().hex
    print(f"::add-mask::{kpw}")
    run = lambda *a: subprocess.run(list(a), check=True, capture_output=True, text=True)
    subprocess.run(["security", "delete-keychain", kc], capture_output=True)
    run("security", "create-keychain", "-p", kpw, kc)
    run("security", "set-keychain-settings", "-lut", "21600", kc)
    run("security", "unlock-keychain", "-p", kpw, kc)
    run("security", "import", path, "-k", kc, "-P", pw, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security", "-T", "/usr/bin/productbuild")
    run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", kpw, kc)
    existing = subprocess.run(["security", "list-keychains", "-d", "user"], capture_output=True, text=True).stdout.split()
    run("security", "list-keychains", "-d", "user", "-s", kc, *[e.strip('"') for e in existing if "rr-signing" not in e])
    os.remove(path)
    note("Keychain", "Apple Distribution identity installed for signing")


def main():
    key, cert = distribution_identity()

    serial = f"{cert.serial_number:X}".lstrip("0")
    dist = api("GET", "/certificates", params={"limit": 200})["data"]
    match = [c for c in dist if c["attributes"].get("serialNumber", "").upper().lstrip("0") == serial]
    if not match:
        fail("Certificate", f"Apple doesn't list a certificate with serial {serial}. It may have been revoked.")
    cert_id = match[0]["id"]

    bundles = api("GET", "/bundleIds", params={"filter[identifier]": BUNDLE, "limit": 20})["data"]
    bundles = [b for b in bundles if b["attributes"]["identifier"] == BUNDLE]
    if not bundles:
        fail("Bundle ID", f"{BUNDLE} isn't registered under Certificates, Identifiers & Profiles.")
    main_uuid = install_profile(profile_for(bundles[0], cert_id, "The Reading Room iOS App Store"))
    # the Share menu extension and the Home Screen widgets are separate bundles with profiles of their own
    share_uuid = install_profile(profile_for(ensure_bundle(BUNDLE + ".share", "The Reading Room Share"), cert_id, "The Reading Room Share App Store"))
    widgets_uuid = install_profile(profile_for(ensure_bundle(BUNDLE + ".widgets", "The Reading Room Widgets"), cert_id, "The Reading Room Widgets App Store"))

    install_identity(key, cert)
    with open(os.environ["GITHUB_ENV"], "a") as env:
        env.write(f"RR_PROFILE_MAIN={main_uuid}\nRR_PROFILE_SHARE={share_uuid}\nRR_PROFILE_WIDGETS={widgets_uuid}\n")


if __name__ == "__main__":
    main()
