from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = "django-ollama-local-dev-key-change-me"
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "chat",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]

ROOT_URLCONF = "ollama_chat.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

WSGI_APPLICATION = "ollama_chat.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Dubai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

OLLAMA_BASE_URL = "http://127.0.0.1:11434"


OLLAMA_SYSTEM_PROMPT = """You are a helpful local AI assistant. For normal requests, answer immediately and concisely; do not simulate or narrate a thinking process. Answer directly and clearly. Do not expose private chain-of-thought, hidden reasoning, or internal deliberation. If the user asks for reasoning, provide a concise explanation of the result and the important steps, not private internal thoughts. When the user asks for a Mermaid diagram, output ONLY valid Mermaid syntax inside a fenced ```mermaid code block. Prefer simple flowchart TD or LR syntax. IMPORTANT Mermaid edge-label rule: use A -->|Label| B, never A -->|Label|> B. Do not put an extra > after the closing | of an edge label. Put each flowchart statement on its own line. Keep node IDs simple, keep labels readable, quote labels containing Mermaid-reserved characters, and avoid unsupported HTML or special characters unless properly escaped. Do not add commentary inside the Mermaid block."""
