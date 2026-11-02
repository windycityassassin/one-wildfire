"""Serve the web app locally with caching turned off, so a reload always picks up edited files.

    python3 serve.py                 # web/ at http://127.0.0.1:8765
    python3 serve.py 8766 web-v6     # another copy, on its own port
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent


class Server(http.server.ThreadingHTTPServer):
    # the default queue of 5 waiting connections overflows when the browser fetches every module at once,
    # and macOS then resets the extra connections (ERR_CONNECTION_RESET)
    request_queue_size = 128
    daemon_threads = True


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    WEB = ROOT / (sys.argv[2] if len(sys.argv) > 2 else "web")
    handler = functools.partial(NoCache, directory=str(WEB))
    with Server(("127.0.0.1", port), handler) as srv:
        print(f"Serving {WEB} at http://127.0.0.1:{port}")
        srv.serve_forever()
