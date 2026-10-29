"""Prepare iPhone/iPad signing on the GitHub Mac, using what the Mac App Store build already has.

- Takes the "Apple Distribution" identity out of APPLE_APPSTORE_CERTS (that certificate signs iOS apps too).
- Finds or creates an "App Store" provisioning profile for the app through the App Store Connect API.
- Writes IOS_CERTIFICATE, IOS_CERTIFICATE_PASSWORD and IOS_MOBILE_PROVISION to $GITHUB_ENV for Tauri.

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


def main():
    key, cert = distribution_identity()

    bundles = api("GET", "/bundleIds", params={"filter[identifier]": BUNDLE, "limit": 20})["data"]
    bundles = [b for b in bundles if b["attributes"]["identifier"] == BUNDLE]
    if not bundles:
        fail("Bundle ID", f"{BUNDLE} isn't registered under Certificates, Identifiers & Profiles.")
    bundle = bundles[0]
    note("Bundle ID", f"{BUNDLE} ({bundle['attributes'].get('platform')})")

    serial = f"{cert.serial_number:X}".lstrip("0")
    dist = api("GET", "/certificates", params={"limit": 200})["data"]
    match = [c for c in dist if c["attributes"].get("serialNumber", "").upper().lstrip("0") == serial]
    if not match:
        fail("Certificate", f"Apple doesn't list a certificate with serial {serial}. It may have been revoked.")
    cert_id = match[0]["id"]

    name = "The Reading Room iOS App Store"
    profiles = api("GET", f"/bundleIds/{bundle['id']}/profiles", params={"limit": 50})["data"]
    usable = [p for p in profiles if p["attributes"]["profileType"] == "IOS_APP_STORE" and p["attributes"]["profileState"] == "ACTIVE"]
    profile = None
    for p in usable:  # one that includes our certificate
        certs = api("GET", f"/profiles/{p['id']}/certificates")["data"]
        if any(c["id"] == cert_id for c in certs):
            profile = p
            break
    if profile:
        note("Profile", f"Using existing profile {profile['attributes']['name']}")
    else:
        profile = api("POST", "/profiles", json={"data": {
            "type": "profiles",
            "attributes": {"name": f"{name} {time.strftime('%Y-%m-%d %H%M')}", "profileType": "IOS_APP_STORE"},
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
                "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
            }}})["data"]
        note("Profile", f"Created {profile['attributes']['name']}")
    content = profile["attributes"].get("profileContent") or api("GET", f"/profiles/{profile['id']}")["data"]["attributes"]["profileContent"]

    # A .p12 with just this identity, in the older encryption the macOS keychain imports reliably.
    pw = uuid.uuid4().hex
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(pw.encode()))
    p12 = pkcs12.serialize_key_and_certificates(b"Apple Distribution", key, cert, None, enc)
    print(f"::add-mask::{pw}")
    with open(os.environ["GITHUB_ENV"], "a") as env:
        env.write(f"IOS_CERTIFICATE={base64.b64encode(p12).decode()}\n")
        env.write(f"IOS_CERTIFICATE_PASSWORD={pw}\n")
        env.write(f"IOS_MOBILE_PROVISION={content}\n")


if __name__ == "__main__":
    main()
