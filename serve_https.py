"""Serve web/ over HTTPS on the local network, so a phone, tablet or headset can try VR and AR
(WebXR only runs on https or localhost).

    python3 serve_https.py            # https://<this Mac's LAN address>:8443
    python3 serve_https.py 8443 web   # port and folder, like serve.py

Uses the self-signed certificate in .certs/ (made with openssl for the Mac's LAN address). The device
will warn about it once: Advanced -> Proceed. Nothing here is reachable from outside the local network.
"""
import functools
import pathlib
import ssl
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from serve import NoCache, Server, ROOT

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    web = ROOT / (sys.argv[2] if len(sys.argv) > 2 else "web")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(ROOT / ".certs/lan.pem", ROOT / ".certs/lan-key.pem")
    srv = Server(("0.0.0.0", port), functools.partial(NoCache, directory=str(web)))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    print(f"https://0.0.0.0:{port}  (folder: {web.name})")
    srv.serve_forever()
