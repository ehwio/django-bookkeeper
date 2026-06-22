"""Django settings for Playwright E2E tests.

Extends the unit-test settings with the extras a live server needs:
sessions, messages, staticfiles, CSRF, and a temp media root.
"""

import tempfile

SECRET_KEY = "e2e-test-secret-key-not-for-production"

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
CSRF_TRUSTED_ORIGINS = ["http://localhost", "http://127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "bookkeeper",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Temp directory created once per session; cleaned up by the OS
_MEDIA_TMPDIR = tempfile.mkdtemp(prefix="bk-e2e-media-")
MEDIA_ROOT = _MEDIA_TMPDIR
MEDIA_URL = "/media/"

STATIC_URL = "/static/"

ROOT_URLCONF = "tests.e2e_urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/books/"

USE_TZ = True
