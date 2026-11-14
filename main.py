#!/usr/bin/env python3
"""
SlideCraft — локальный прокси + статический сервер с обязательной регистрацией.

Всё служебное (ключ, модели) читается из `.env` рядом с этим файлом:
  OLLAMA_API_KEY      — боевой ключ, НЕ светится в браузере
  OLLAMA_MODEL_FAST   — модель для режима «Быстро»
  OLLAMA_MODEL_THINK  — модель для режима «Раздумия»
  ALLOWED_ORIGIN      — CORS origin (по умолчанию * для локальной разработки)

АВТОРИЗАЦИЯ:
  - users.json       — {username: {salt, hash, iterations, created}}
  - sessions.json    — {token: {username, expires}}
  - Пароль хешируется PBKDF2-HMAC-SHA256 (100k итераций, 16-байтовый salt).
  - Сессия — 32 случайных байта URL-safe base64, в HttpOnly-куке sc_session.
  - Неавторизованные запросы к /, /api/chat, /config, статики — редирект на /login.
  - Публичные маршруты: /login (HTML), /register (POST), /login (POST).

Запуск:  python main.py
Открыть: http://127.0.0.1:8787/  →  редирект на /login
"""
import os
import sys
import re
import ssl
import time
import secrets
import hmac
import hashlib
import mimetypes
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from http.cookies import SimpleCookie
import urllib.request
import urllib.error
import json
import shutil
import subprocess
import tempfile

# ---------- веб-поиск для промпта презентации ----------
try:
    from search import search_web, format_for_prompt, is_available as search_is_available
    SEARCH_AVAILABLE = search_is_available()
except ImportError:
    SEARCH_AVAILABLE = False
    print("⚠️  search.py не найден — веб-поиск отключён.", file=sys.stderr)


# ============================================================
# Загрузка .env (без внешних зависимостей — pure stdlib)
# ============================================================
_STRIP_QUOTES = '"\'\u2018\u2019\u201c\u201d\u00ab\u00bb'

def _load_env(path=".env"):
    """Минимальный парсер .env. Реальные env-переменные оболочки имеют приоритет."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip(_STRIP_QUOTES).strip()
            os.environ.setdefault(key, val)


# STATIC_DIR определяется ДО _load_env, потому что _load_env использует
# путь os.path.join(STATIC_DIR, ".env") — ищет .env рядом с main.py,
# а не в CWD (защита от запуска из другой директории).
STATIC_DIR     = os.path.dirname(os.path.abspath(__file__))

_load_env(os.path.join(STATIC_DIR, ".env"))

API_KEY        = os.environ.get("OLLAMA_API_KEY", "").strip()
MODEL_FAST     = os.environ.get("OLLAMA_MODEL_FAST",  "gemma4:31b")
MODEL_THINK    = os.environ.get("OLLAMA_MODEL_THINK", "nemotron-3-super")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

# Провайдер ИИ: "ollama", "groq", "openai", "gigachat" (Сбер, работает в РФ).
AI_PROVIDER = os.environ.get("AI_PROVIDER", "ollama").lower()
if AI_PROVIDER == "groq":
    AI_URL = "https://api.groq.com/openai/v1/chat/completions"
elif AI_PROVIDER == "openai":
    AI_URL = os.environ.get("AI_URL", "https://api.openai.com/v1/chat/completions")
elif AI_PROVIDER == "gigachat":
    AI_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
    AI_OAUTH_URL = "https://gigachat.devices.sberbank.ru/api/v1/oauth"
else:
    AI_URL = os.environ.get("AI_URL", "https://ollama.com/api/chat")

# GigaChat: OAuth токен (живёт ~30 минут, обновляется автоматически)
_giga_token = None
_giga_token_expires = 0

def _get_gigachat_token():
    """Получает OAuth access_token для GigaChat.
    Кеширует на 25 минут (токен живёт 30)."""
    global _giga_token, _giga_token_expires
    if _giga_token and time.time() < _giga_token_expires:
        return _giga_token
    import uuid
    rquid = str(uuid.uuid4())
    req = urllib.request.Request(
        AI_OAUTH_URL,
        headers={
            "Authorization": f"Basic {API_KEY}",
            "RqUID": rquid,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
        data=b"scope=GIGACHAT_API_PERS",
    )
    # GigaChat использует сертификаты Минцифры — отключаем верификацию
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            data = json.loads(r.read())
            _giga_token = data.get("access_token")
            _giga_token_expires = time.time() + 25 * 60  # 25 минут
            print("[gigachat] token получен", file=sys.stderr)
            return _giga_token
    except Exception as e:
        print(f"[gigachat] ошибка получения токена: {e}", file=sys.stderr)
        return None

# Хост для привязки сервера.
# "127.0.0.1" — только этот компьютер (по умолчанию, безопасно).
# "0.0.0.0"   — все интерфейсы, в т.ч. LAN/WiFi. Нужно чтобы зайти
#              с телефона в той же сети. Включает auth-защиту.
def _env_int(name, default):
    """Безопасное чтение int из env. Если значение не число — используем default
    и пишем warning в stderr (вместо падения сервера при плохом .env)."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except (ValueError, TypeError):
        print(f"⚠️  {name}='{raw}' не число — использую default={default}", file=sys.stderr)
        return default

BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1")
BIND_PORT = _env_int("BIND_PORT", 8787)

# HTTPS: современные мобильные браузеры по умолчанию пробуют https://
# при вводе адреса без протокола. Чтобы не воевать с HTTPS-First режимом
# Chrome/Safari, можно включить HTTPS на сервере (self-signed сертификат).
# USE_HTTPS=true — сервер генерирует cert.pem/key.pem (если их нет) и
# слушает HTTPS. Браузер покажет предупреждение «подключение не защищено» —
# надо нажать «Дополнительно → Перейти на сайт», после этого работает.
USE_HTTPS = os.environ.get("USE_HTTPS", "false").lower() in ("true", "1", "yes", "on")
CERT_FILE = os.environ.get("SSL_CERT_FILE", os.path.join(STATIC_DIR, "cert.pem"))
KEY_FILE  = os.environ.get("SSL_KEY_FILE",  os.path.join(STATIC_DIR, "key.pem"))

# Веб-поиск для промпта презентации (duckduckgo-search)
SEARCH_ENABLED      = os.environ.get("SEARCH_ENABLED", "true").lower() in ("true", "1", "yes", "on")
SEARCH_MAX_RESULTS  = _env_int("SEARCH_MAX_RESULTS", 5)
SEARCH_REGION       = os.environ.get("SEARCH_REGION", "ru-ru")

if SEARCH_ENABLED and not SEARCH_AVAILABLE:
    print(
        "⚠️  SEARCH_ENABLED=true, но библиотека duckduckgo-search не установлена. "
        "pip install duckduckgo-search  (или pip install ddgs)",
        file=sys.stderr,
    )

if not API_KEY:
    print("⚠️  OLLAMA_API_KEY пустой. Скопируй .env.example в .env и проставь ключ.",
          file=sys.stderr)
elif not API_KEY.isascii():
    print("⚠️  OLLAMA_API_KEY содержит не-ASCII символы. Проверь .env на смарт-кавычки.",
          file=sys.stderr)


# ============================================================
# Auth: хранилище пользователей и сессий
# ============================================================
USERS_FILE    = os.path.join(STATIC_DIR, "users.json")
SESSIONS_FILE = os.path.join(STATIC_DIR, "sessions.json")
SESSION_COOKIE = "sc_session"
SESSION_TTL    = 30 * 24 * 3600  # 30 дней
PBKDF2_ITERS   = 600_000  # OWASP 2023 рекомендует ≥600k для PBKDF2-HMAC-SHA256
# Старые записи в users.json могут иметь iterations=100_000 — verify_password
# читает поле iterations из записи, так что обратная совместимость сохраняется.

# Файлы, которые нельзя отдавать как статику
_PROTECTED_FILES = {
    "users.json", "sessions.json", ".env", ".env.example",
    "main.py", "search.py",
    "cert.pem", "key.pem",   # self-signed сертификаты (если USE_HTTPS=true)
}


def _load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data, private=False):
    """Атомарная запись JSON: пишем во временный файл, потом os.replace.
    Защита от race condition — два одновременных _save_json не испортят файл
    (один записывает в temp, потом атомарно заменяет).
    Если private=True — файл получает права 0o600 (rw------- только владелец).
    Используется для users.json и sessions.json, чтобы другие пользователи
    системы не могли прочитать хеши паролей и токены сессий."""
    import tempfile
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(path) or ".",
            prefix=".tmp_",
            suffix=os.path.basename(path),
        )
        # mkstemp создаёт файл с правами 0o600 уже по умолчанию (на POSIX),
        # но явно установим чтобы гарантировать — даже если umask странный.
        if private:
            try: os.fchmod(fd, 0o600)
            except OSError: pass
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            # os.replace — атомарная операция на POSIX (rename(2)).
            # На Windows тоже работает с Python 3.3+.
            os.replace(tmp_path, path)
            tmp_path = None  # успешно заменён, не удалять
            # Дополнительная гарантия прав на финальном файле
            if private:
                try: os.chmod(path, 0o600)
                except OSError: pass
        except Exception:
            raise
    except Exception as e:
        print(f"save_json {path}: {e}", file=sys.stderr)
        # Чистим temp-файл если он остался
        if tmp_path and os.path.exists(tmp_path):
            try: os.unlink(tmp_path)
            except OSError: pass


def _hash_password(password, salt_hex=None, iterations=PBKDF2_ITERS):
    if salt_hex is None:
        salt = secrets.token_bytes(16)
    else:
        salt = bytes.fromhex(salt_hex)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return salt.hex(), h.hex()


def _verify_password(password, salt_hex, hash_hex, iterations=PBKDF2_ITERS):
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(h.hex(), hash_hex)


def _create_session(username):
    token = secrets.token_urlsafe(32)
    sessions = _load_json(SESSIONS_FILE, {})
    # Заодно чистим протухшие сессии
    now = time.time()
    sessions = {t: v for t, v in sessions.items() if v.get("expires", 0) > now}
    sessions[token] = {"username": username, "expires": now + SESSION_TTL}
    _save_json(SESSIONS_FILE, sessions, private=True)
    return token


def _get_session_user(headers):
    cookie_header = headers.get("Cookie", "")
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return None
    morsel = cookie.get(SESSION_COOKIE)
    if not morsel:
        return None
    token = morsel.value
    sessions = _load_json(SESSIONS_FILE, {})
    entry = sessions.get(token)
    if not entry:
        return None
    if time.time() > entry.get("expires", 0):
        sessions.pop(token, None)
        _save_json(SESSIONS_FILE, sessions, private=True)
        return None
    return entry.get("username")


def _destroy_session_by_cookie(headers):
    cookie_header = headers.get("Cookie", "")
    if not cookie_header:
        return
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return
    morsel = cookie.get(SESSION_COOKIE)
    if not morsel:
        return
    sessions = _load_json(SESSIONS_FILE, {})
    sessions.pop(morsel.value, None)
    _save_json(SESSIONS_FILE, sessions, private=True)


def _get_local_ips():
    """Возвращает список IPv4-адресов этого компьютера в локальной сети
    (без loopback 127.x.x.x). Нужно для подсказки «заходи с телефона по такому-то IP».
    Pure stdlib, без зависимостей."""
    ips = []
    # Способ 1: socket — открываем UDP-сокет к публичному адресу
    # (без реальной отправки данных) и смотрим, какой локальный IP использовался.
    # Это работает на Linux/Mac/Windows без прав root.
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                ips.append(ip)
        except OSError:
            pass
        finally:
            s.close()
    except Exception:
        pass
    # Способ 2: hostname + getaddrinfo
    try:
        import socket
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def _ensure_self_signed_cert():
    """Если cert.pem/key.pem не существуют — генерируем self-signed
    через openssl. Subject Alternative Name включает все локальные IP,
    чтобы браузер принимал сертификат для любого из них.
    Возвращает True если сертификаты готовы к использованию."""
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return True
    openssl = shutil.which("openssl")
    if not openssl:
        print(
            "⚠️  USE_HTTPS=true, но openssl не найден в PATH. "
            "Установи: sudo apt install openssl",
            file=sys.stderr,
        )
        return False
    # Subject Alternative Name: DNS:localhost + IP для каждого локального адреса
    san_parts = ["DNS:localhost"]
    for ip in _get_local_ips():
        san_parts.append(f"IP:{ip}")
    san = ",".join(san_parts)
    print(f"[ssl] генерирую self-signed сертификат (SAN: {san})...")
    cmd = [
        openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", KEY_FILE, "-out", CERT_FILE,
        "-days", "3650",   # 10 лет — чтобы не пересоздавать
        "-subj", "/CN=SlideCraft-Local",
        "-addext", f"subjectAltName={san}",
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=30)
        print(f"[ssl] сертификат создан:")
        print(f"      {CERT_FILE}")
        print(f"      {KEY_FILE}")
        print(f"      (в .gitignore — не коммить)")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[ssl] ошибка генерации сертификата: {e.stderr.decode(errors='replace')}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[ssl] ошибка: {e}", file=sys.stderr)
        return False


# Конфиг, который увидит браузер. Ключа здесь НЕТ.
CONFIG_FOR_FRONTEND = {
    "useProxy": True,
    "proxyUrl": "/api/chat",
    "models": {"fast": MODEL_FAST, "think": MODEL_THINK},
}


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    # ---------- утилиты ответа ----------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _security_headers(self, no_store=False):
        """Заголовки безопасности на каждый ответ.
        no_store=True — добавить Cache-Control: no-store (для auth-ответов
        и ответов с пользовательскими данными, чтобы браузер не кешировал
        их на диск и не утёк после logout)."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if no_store:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        # HSTS только при HTTPS — иначе можно «запомнить» HTTP и застрять
        if USE_HTTPS:
            self.send_header("Strict-Transport-Security",
                             "max-age=31536000; includeSubDomains")

    def _send(self, code, body, ctype="application/json", no_store=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self._security_headers(no_store=no_store)
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # клиент ушёл до конца ответа — ну и ладно

    def _send_with_cookie(self, code, body, cookie_str, ctype="application/json",
                          no_store=True):
        """При установке/удалении cookie — no_store=True по умолчанию,
        чтобы auth-ответы не кешировались."""
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if cookie_str:
            self.send_header("Set-Cookie", cookie_str)
        self._security_headers(no_store=no_store)
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _internal_error(self, e, context=""):
        """Логирует traceback с уникальным ID, возвращает пользователю
        только ID — без раскрытия внутренних деталей (путей, имён, версий)."""
        err_id = secrets.token_hex(8)
        import traceback
        print(f"[error {err_id}] {context}: {traceback.format_exc()}", file=sys.stderr)
        self._send(500, json.dumps({
            "error": f"внутренняя ошибка сервера (id={err_id})"
        }).encode())

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self._security_headers()
        self._cors()
        self.end_headers()

    # ---------- статические файлы ----------
    def _serve_file(self, rel):
        rel = rel.split("?", 1)[0].lstrip("/")
        if not rel:
            rel = "index.html"
        # защита от path traversal и symlink-атак:
        # normpath — схлопывает ../
        # realpath — разрешает симлинки (если в STATIC_DIR есть symlink
        #            наружу, этот путь закрывается)
        safe = os.path.normpath(os.path.join(STATIC_DIR, rel))
        try:
            real_static = os.path.realpath(STATIC_DIR)
            real_safe = os.path.realpath(safe)
        except OSError:
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        # real_safe должен быть внутри real_static (или совпадать с ним)
        if not (real_safe == real_static or real_safe.startswith(real_static + os.sep)):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(safe):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        base = os.path.basename(safe)
        if base in _PROTECTED_FILES:
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        ctype, _ = mimetypes.guess_type(safe)
        with open(safe, "rb") as f:
            self._send(200, f.read(), ctype or "application/octet-stream")

    # ---------- auth-проверка ----------
    def _require_auth(self):
        """Возвращает username или отправляет 401/редирект и возвращает None."""
        user = _get_session_user(self.headers)
        if user:
            return user
        # API-запросы (json) — возвращаем 401
        if (self.path.startswith("/api/")
            or self.path == "/config"
            or self.path == "/convert"):
            self._send(401, json.dumps({"error": "auth required"}).encode())
            return None
        # Запросы страниц — редирект на /login
        self._redirect("/login")
        return None

    # ---------- маршруты GET ----------
    def do_GET(self):
        # Публичные: страница входа и её ассеты
        if self.path in ("/login", "/login.html"):
            self._serve_file("login.html")
            return

        # Всё остальное требует авторизации
        user = self._require_auth()
        if not user:
            return

        if self.path == "/config":
            cfg = dict(CONFIG_FOR_FRONTEND)
            cfg["user"] = user
            self._send(200, json.dumps(cfg).encode(), no_store=True)
            return
        if self.path == "/api/chat":  # проверка живости (без раскрытия имени пользователя)
            self._send(200, json.dumps({"ok": True, "msg": "proxy works"}).encode(),
                       no_store=True)
            return
        self._serve_file(self.path)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ---------- маршруты POST ----------
    def do_POST(self):
        # /logout не требует body — обрабатываем до проверки размера,
        # иначе POST без Content-Length получит 400 "пустое тело запроса".
        if self.path == "/logout":
            user = self._require_auth()
            if not user:
                return
            self._handle_logout()
            return

        # Лимит размера тела запроса — защита от OOM-DoS
        MAX_BODY = 50 * 1024 * 1024  # 50 МБ
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            self._send(413, json.dumps({
                "error": f"тело запроса слишком большое (макс {MAX_BODY // (1024*1024)} МБ)"
            }).encode())
            return
        if length <= 0:
            self._send(400, json.dumps({"error": "пустое тело запроса"}).encode())
            return
        body = self.rfile.read(length)

        # Публичные auth-эндпоинты (с rate limiting)
        if self.path == "/register":
            if not self._check_rate_limit("register"):
                self._send(429, json.dumps({
                    "error": "слишком много регистраций, попробуй через минуту"
                }).encode())
                return
            self._handle_register(body)
            return
        if self.path == "/login":
            if not self._check_rate_limit("login"):
                self._send(429, json.dumps({
                    "error": "слишком много попыток входа, попробуй через минуту"
                }).encode())
                return
            self._handle_login(body)
            return

        # Всё остальное требует авторизации
        user = self._require_auth()
        if not user:
            return

        # /api/chat — rate limit 20/мин (тяжёлые запросы к Ollama, 300s timeout)
        if self.path == "/api/chat":
            if not self._check_rate_limit("chat", max_attempts=20, window_sec=60):
                self._send(429, json.dumps({
                    "error": "слишком много запросов к ИИ, попробуй через минуту"
                }).encode())
                return
            self._forward_chat(body, user)
            return
        # /convert — rate limit 5/мин (LibreOffice тяжёлый, ~100 МБ RAM на вызов)
        if self.path == "/convert":
            if not self._check_rate_limit("convert", max_attempts=5, window_sec=60):
                self._send(429, json.dumps({
                    "error": "слишком много конвертаций, попробуй через минуту"
                }).encode())
                return
            self._convert_pptx_to_odp(body)
            return
        self._send(404, json.dumps({"error": "not found"}).encode())

    # ---------- rate limiting ----------
    # Простая in-memory реализация: {ip: [(timestamp, ...), ...]}.
    # Для каждого IP храним до max_attempts событий в окне window_sec секунд.
    # _rate_lock создаётся на уровне модуля (не lazy) — иначе два потока
    # одновременно увидят None и создадут разные Lock'и (race condition).
    import threading as _threading
    _rate_buckets = {}  # {(action, ip): [timestamps]}
    _rate_lock = _threading.Lock()
    _rate_cleanup_counter = 0  # раз в N вызовов — чистим пустые бакеты

    def _check_rate_limit(self, action, max_attempts=10, window_sec=60):
        """Возвращает True если запрос разрешён, False если превышен лимит.
        Действия: 'login', 'register'. Лимит — max_attempts за window_sec секунд."""
        # IP клиента — берём из заголовка X-Forwarded-For если есть (за прокси),
        # иначе из client_address. Если под SSH-туннелем — все будут с 127.0.0.1,
        # но это нормальный сценарий для dev.
        fwd = self.headers.get("X-Forwarded-For", "")
        ip = (fwd.split(",")[0].strip() if fwd else self.client_address[0]) or "unknown"
        key = (action, ip)
        now = time.time()
        with Handler._rate_lock:
            events = Handler._rate_buckets.get(key, [])
            # Чистим старые
            events = [t for t in events if now - t < window_sec]
            if len(events) >= max_attempts:
                Handler._rate_buckets[key] = events
                return False
            events.append(now)
            Handler._rate_buckets[key] = events
            # Раз в 1000 вызовов — чистим пустые бакеты, чтобы словарь
            # не рос бесконечно (memory leak fix).
            Handler._rate_cleanup_counter += 1
            if Handler._rate_cleanup_counter >= 1000:
                Handler._rate_cleanup_counter = 0
                cutoff = now - window_sec
                Handler._rate_buckets = {
                    k: v for k, v in Handler._rate_buckets.items()
                    if any(t > cutoff for t in v)
                }
            return True

    # ---------- auth-обработчики ----------
    def _handle_register(self, body):
        try:
            data = json.loads(body)
            username = (data.get("username") or "").strip()
            password = data.get("password") or ""
        except Exception:
            self._send(400, json.dumps({"error": "Некорректный запрос"}).encode())
            return
        if len(username) < 3:
            self._send(400, json.dumps({"error": "Имя пользователя минимум 3 символа"}).encode())
            return
        if len(username) > 32:
            self._send(400, json.dumps({"error": "Имя пользователя максимум 32 символа"}).encode())
            return
        # Password policy: 8-1024 символа. Нижняя граница — защита от слабых паролей,
        # верхняя — от DoS через PBKDF2 на огромном пароле (100k+ итераций × 1 МБ пароль = секунды на запрос).
        if len(password) < 8:
            self._send(400, json.dumps({"error": "Пароль минимум 8 символов"}).encode())
            return
        if len(password) > 1024:
            self._send(400, json.dumps({"error": "Пароль слишком длинный (макс 1024 символа)"}).encode())
            return
        # Запретим подозрительные символы в username
        if not all(c.isalnum() or c in "._-@" for c in username):
            self._send(400, json.dumps({
                "error": "В имени пользователя допустимы только буквы, цифры и . _ - @"
            }).encode())
            return

        users = _load_json(USERS_FILE, {})
        if username in users:
            # Защита от username enumeration: не подтверждаем, что пользователь
            # существует. Возвращаем тот же ответ, что и при успешной регистрации,
            # но БЕЗ session-cookie — атакующий не сможет отличить "создан" от
            # "уже существует". Реальный пользователь после этого попадёт на /login
            # (т.к. без cookie) и сможет войти со своим паролем.
            print(f"[auth] register on existing username (silent): {username}", file=sys.stderr)
            self._send(200, json.dumps({"ok": True, "user": username}).encode())
            return

        salt_hex, hash_hex = _hash_password(password)
        users[username] = {
            "salt": salt_hex,
            "hash": hash_hex,
            "iterations": PBKDF2_ITERS,
            "created": time.time(),
        }
        _save_json(USERS_FILE, users, private=True)

        token = _create_session(username)
        # Cookie флаги: HttpOnly (защита от XSS-кражи), SameSite=Strict (защита от CSRF),
        # Secure (только по HTTPS) — добавляется если USE_HTTPS=true.
        cookie = f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL}; SameSite=Strict"
        if USE_HTTPS:
            cookie += "; Secure"
        self._send_with_cookie(
            200,
            json.dumps({"ok": True, "user": username}).encode(),
            cookie,
        )
        print(f"[auth] registered: {username}", file=sys.stderr)

    def _handle_login(self, body):
        try:
            data = json.loads(body)
            username = (data.get("username") or "").strip()
            password = data.get("password") or ""
        except Exception:
            self._send(400, json.dumps({"error": "Некорректный запрос"}).encode())
            return
        users = _load_json(USERS_FILE, {})
        user = users.get(username)
        # Защита от повреждённого/подменённого users.json — запись должна быть
        # dict с обязательными полями salt, hash. Иначе _verify_password упадёт
        # с KeyError и поток умрёт с traceback в логах.
        if not isinstance(user, dict) or "salt" not in user or "hash" not in user:
            # Не раскрываем, что запись повреждена — просто отдаём как "неверный пароль"
            self._send(401, json.dumps({"error": "Неверное имя пользователя или пароль"}).encode())
            return
        if not _verify_password(
                password, user["salt"], user["hash"],
                user.get("iterations", PBKDF2_ITERS)):
            self._send(401, json.dumps({"error": "Неверное имя пользователя или пароль"}).encode())
            return
        token = _create_session(username)
        cookie = f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL}; SameSite=Strict"
        if USE_HTTPS:
            cookie += "; Secure"
        self._send_with_cookie(
            200,
            json.dumps({"ok": True, "user": username}).encode(),
            cookie,
        )
        print(f"[auth] login: {username}", file=sys.stderr)

    def _handle_logout(self):
        _destroy_session_by_cookie(self.headers)
        cookie = f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict"
        if USE_HTTPS:
            cookie += "; Secure"
        self._send_with_cookie(200, json.dumps({"ok": True}).encode(), cookie)

    # ---------- чат: ключ живёт на сервере ----------
    def _forward_chat(self, body, user):
        if not API_KEY:
            self._send(503, json.dumps({
                "error": "OLLAMA_API_KEY не задан на сервере. Создай .env рядом с main.py"
            }).encode())
            return
        try:
            payload = json.loads(body)
        except Exception:
            self._send(400, json.dumps({"error": "bad json body"}).encode())
            return

        # Модель подставляет сервер из .env. Клиент присылает только _mode.
        mode = payload.pop("_mode", "fast")
        payload["model"] = MODEL_THINK if mode == "think" else MODEL_FAST
        payload.setdefault("stream", False)

        # ---------- формат запроса в зависимости от провайдера ----------
        is_gemini = "googleapis.com" in AI_URL
        is_gigachat = AI_PROVIDER == "gigachat"
        if AI_PROVIDER in ("groq", "openai") or is_gigachat:
            # OpenAI-совместимый формат (GigaChat тоже совместим)
            payload.pop("format", None)
            payload["temperature"] = payload.get("options", {}).get("temperature", 0.6)
            payload.pop("options", None)
            if not is_gemini and not is_gigachat:
                payload["response_format"] = {"type": "json_object"}
        else:
            payload.setdefault("format", "json")

        # ---------- веб-поиск ----------
        if SEARCH_ENABLED and SEARCH_AVAILABLE:
            self._augment_with_search(payload, user)

        body = json.dumps(payload).encode()

        # ---------- авторизация ----------
        if is_gigachat:
            # GigaChat: OAuth токен (обновляется автоматически)
            token = _get_gigachat_token()
            if not token:
                self._send(503, json.dumps({
                    "error": "Не удалось получить токен GigaChat. Проверь ключ в .env"
                }).encode())
                return
            auth_header = f"Bearer {token}".encode("utf-8")
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE
        else:
            auth_header = f"Bearer {API_KEY}".encode("utf-8")
            ssl_ctx = None

        req = urllib.request.Request(
            AI_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": auth_header,
            },
            method="POST",
        )
        try:
            if ssl_ctx:
                with urllib.request.urlopen(req, timeout=300, context=ssl_ctx) as r:
                    resp_bytes = r.read()
            else:
                with urllib.request.urlopen(req, timeout=300) as r:
                    resp_bytes = r.read()
            # Трансформация ответа: Groq/OpenAI/Gemini/GigaChat → Ollama формат
            if AI_PROVIDER in ("groq", "openai", "gigachat"):
                try:
                    raw = json.loads(resp_bytes)
                    if isinstance(raw, list) and raw:
                        raw = raw[0]
                    content = (raw.get("choices") or [{}])[0] \
                        .get("message", {}).get("content", "")
                    ollama_resp = {"message": {"content": content}, "done": True}
                    resp_bytes = json.dumps(ollama_resp).encode()
                except Exception:
                    pass
            self._send(r.status, resp_bytes)
        except urllib.error.HTTPError as e:
            # Upstream вернул ошибку (401/402/403/429/500 и т.д.).
            # ВАЖНО: 401/403 от upstream НЕ должны проходить как есть —
            # браузер думает что это наш auth-401 и редиректит на /login.
            # Меняем на 502 (Bad Gateway) с оригинальным сообщением.
            upstream_code = e.code
            upstream_body = e.read()
            if upstream_code in (401, 402, 403):
                # Пробуем извлечь сообщение об ошибке
                try:
                    err_data = json.loads(upstream_body)
                    err_msg = err_data.get("error", {}).get("message", "") if isinstance(err_data.get("error"), dict) else str(err_data.get("error", ""))
                except Exception:
                    err_msg = upstream_body.decode("utf-8", errors="replace")[:300]
                self._send(502, json.dumps({
                    "error": f"AI провайдер вернул {upstream_code}: {err_msg}"
                }).encode())
            else:
                # Другие ошибки (429, 500, etc.) — пропускаем как есть
                self._send(upstream_code, upstream_body)
        except Exception as e:
            self._internal_error(e, context=f"_forward_chat user={user}")

    def _augment_with_search(self, payload, user):
        """Извлекает тему из последнего user-сообщения, делает веб-поиск,
        инжектит результаты в system message. Не падает при ошибках."""
        messages = payload.get("messages") or []
        if not messages:
            return
        # Находим последнее user-сообщение
        last_user = None
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                last_user = msg.get("content", "")
                break
        if not last_user:
            return
        # Извлекаем тему из строки "Создай презентацию на тему: \"...\""
        # (так формирует промпт SC.buildPrompt в core.js)
        m = re.search(r'на тему:\s*"([^"]+)"', last_user)
        if not m:
            return  # это не промпт генерации (может быть AI-edit или другое)
        topic = m.group(1).strip()
        if len(topic) < 3:
            return
        # Дополнительные запросы по компаниям для сравнения (если есть)
        # Формат в промпте: "Компании для сравнения: Apple, Google, Microsoft"
        comp_match = re.search(r"Компании для сравнения:\s*([^\n]+)", last_user)
        queries = [topic]
        if comp_match:
            companies_str = comp_match.group(1).strip().rstrip(".")
            # Для каждой компании — отдельный запрос, если их немного
            for c in [c.strip() for c in companies_str.split(",") if c.strip()][:3]:
                queries.append(f"{c} компания выручка сотрудники 2024")

        # Делаем поиск (ограничиваем общее число запросов)
        all_results = []
        for q in queries[:2]:  # максимум 2 запроса — чтобы не замедлять сильно
            try:
                rs = search_web(q, max_results=SEARCH_MAX_RESULTS, region=SEARCH_REGION)
                if rs:
                    all_results.extend(rs)
                    if len(all_results) >= SEARCH_MAX_RESULTS * 2:
                        break
            except Exception as e:
                print(f"[search] query '{q}' failed: {e}", file=sys.stderr)

        if not all_results:
            print(f"[search] no results for topic: {topic}", file=sys.stderr)
            return

        # Дедуплицируем по URL
        seen_urls = set()
        unique = []
        for r in all_results:
            u = r.get("url", "")
            if u and u in seen_urls:
                continue
            if u:
                seen_urls.add(u)
            unique.append(r)
        unique = unique[:SEARCH_MAX_RESULTS * 2]

        context = format_for_prompt(unique, topic)
        if not context:
            return

        # Добавляем контекст в существующий system message (или создаём новый)
        injected = False
        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") == "system":
                msg["content"] = (msg.get("content", "") + "\n\n" + context).strip()
                injected = True
                break
        if not injected:
            messages.insert(0, {"role": "system", "content": context})
        payload["messages"] = messages
        print(
            f"[search] user={user} topic='{topic}' "
            f"queries={len(queries)} results={len(unique)}",
            file=sys.stderr,
        )

    # ---------- конвертация PPTX → ODP ----------
    # Semaphore ограничивает одновременные запуски LibreOffice —
    # каждый ест ~100 МБ RAM. Без лимита 10 параллельных /convert → OOM.
    # Инициализируется на уровне класса (не lazy) — иначе два потока
    # одновременно увидят None и создадут разные семафоры (race condition).
    import threading as _threading2
    _convert_sem = _threading2.BoundedSemaphore(2)

    def _convert_pptx_to_odp(self, body):
        sem = Handler._convert_sem
        if not sem.acquire(timeout=5):
            self._send(503, json.dumps({
                "error": "конвертация занята (слишком много одновременных), попробуй позже"
            }).encode())
            return
        try:
            self._do_convert(body)
        finally:
            sem.release()

    def _do_convert(self, body):
        ctype = self.headers.get("Content-Type", "")
        if "boundary=" not in ctype:
            self._send(400, json.dumps({"error": "no multipart boundary"}).encode())
            return
        boundary = ctype.split("boundary=")[-1].encode()
        filedata = None
        for part in body.split(b"--" + boundary):
            if b'filename="' in part:
                _, _, rest = part.partition(b"\r\n\r\n")
                filedata = rest.rsplit(b"\r\n", 1)[0]
                break
        if not filedata:
            self._send(400, json.dumps({"error": "file not found in request"}).encode())
            return

        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice:
            self._send(500, json.dumps({
                "error": "LibreOffice не найден. Установи: sudo apt install libreoffice-impress"
            }).encode())
            return

        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, "in.pptx")
                with open(src, "wb") as f:
                    f.write(filedata)
                subprocess.run(
                    [soffice, "--headless", "--convert-to", "odp",
                     "--outdir", td, src],
                    capture_output=True, timeout=180,
                )
                out = os.path.join(td, "in.odp")
                if not os.path.exists(out):
                    self._send(500, json.dumps({"error": "конвертация не удалась"}).encode())
                    return
                with open(out, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "application/vnd.oasis.opendocument.presentation")
                self._security_headers()
                self._cors()
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            # Внутренняя ошибка — не раскрываем детали, логируем с ID
            self._internal_error(e, context="_convert_pptx_to_odp")

    def log_message(self, fmt, *args):
        # Подавляем мусор от TLS-handshake: когда браузер стучит по HTTPS
        # на HTTP-порт, сервер получает бинарные байты и парсит их как HTTP-строку.
        # Получается "code 400, message Bad request version ('\x16\x03...')" с
        # непечатными символами. Не логируем это — засоряет вывод.
        try:
            msg = fmt % args
        except Exception:
            return
        if "Bad request version" in msg or "Bad request syntax" in msg:
            return  # это TLS-handshake от браузера — молча пропускаем
        # Если в строке запроса есть не-ASCII байты — тоже пропускаем
        try:
            msg.encode("ascii")
        except UnicodeEncodeError:
            return
        print("[proxy]", msg)


if __name__ == "__main__":
    protocol = "https" if USE_HTTPS else "http"
    print(f"SlideCraft на {protocol}://{BIND_HOST}:{BIND_PORT}/  (chat + config + static + auth + search)")
    print(f"  ai provider = {AI_PROVIDER}")
    print(f"  ai url      = {AI_URL}")
    print(f"  model.fast  = {MODEL_FAST}")
    print(f"  model.think = {MODEL_THINK}")
    print(f"  key set     = {bool(API_KEY)}")
    print(f"  web search  = {'on' if (SEARCH_ENABLED and SEARCH_AVAILABLE) else 'off'}"
          + (f" (region={SEARCH_REGION}, max={SEARCH_MAX_RESULTS})" if (SEARCH_ENABLED and SEARCH_AVAILABLE) else ""))
    print(f"  https       = {'on (self-signed)' if USE_HTTPS else 'off'}")
    users_count = len(_load_json(USERS_FILE, {}))
    print(f"  users       = {users_count}")
    print(f"  first open  → /login (обязательная регистрация)")

    # Если слушаем на всех интерфейсах — показываем локальные IP,
    # чтобы пользователь знал, по какому адресу заходить с телефона.
    if BIND_HOST == "0.0.0.0":
        print()
        print(f"📡 Сервер доступен в локальной сети. Зайди с телефона по одному из адресов:")
        local_ips = _get_local_ips()
        if local_ips:
            for ip in local_ips:
                print(f"   {protocol}://{ip}:{BIND_PORT}/")
        else:
            print("   (не удалось определить локальный IP — посмотри `hostname -I` или `ip addr`)")

        if USE_HTTPS:
            print()
            print("🔒 HTTPS включён с self-signed сертификатом. Браузер телефона")
            print("   покажет предупреждение «Подключение не защищено» — это нормально")
            print("   для локальной сети. Нажми «Дополнительно → Перейти на сайт».")
        else:
            print()
            print("⚠️  ВАЖНО: современные браузеры (Chrome/Safari) на телефоне по умолчанию")
            print("   пробуют HTTPS для всех адресов. Если браузер не подключается —")
            print("   либо явно вводи http:// перед адресом, либо включи USE_HTTPS=true в .env")
            print()
            print("⚠️  Сервер виден всем устройствам в сети. Auth включён по умолчанию.")

        if BIND_PORT < 1024:
            print(f"⚠️  Порт {BIND_PORT} требует root-прав.")
        # Подсказка про firewall
        print()
        print("Если телефон всё ещё не подключается — возможно, блокирует firewall:")
        print(f"   sudo ufw allow {BIND_PORT}/tcp    (на Ubuntu/Pop!_OS)")
        print(f"   sudo firewall-cmd --add-port={BIND_PORT}/tcp --permanent && sudo firewall-cmd --reload   (на Fedora/RHEL)")

    # Если USE_HTTPS=true — проверяем сертификат, оборачиваем сокет в SSL
    httpd = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    if USE_HTTPS:
        if not _ensure_self_signed_cert():
            print()
            print("⚠️  Не удалось создать сертификат. Запускаю без HTTPS.")
            print("    На телефоне вводи адрес С ЯВНЫМ http:// префиксом:")
            print(f"    http://<IP-компьютера>:{BIND_PORT}/")
        else:
            import ssl
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(CERT_FILE, KEY_FILE)
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
            print(f"[ssl] слушаю HTTPS на {BIND_HOST}:{BIND_PORT}")
    httpd.serve_forever()
