"""Minimal Django settings for running the test suite."""
SECRET_KEY = "test-secret-key-not-for-production"

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "bookkeeper",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

MEDIA_ROOT = "/tmp/bookkeeper-test-media/"
MEDIA_URL = "/media/"

ROOT_URLCONF = "tests.urls"

USE_TZ = True
