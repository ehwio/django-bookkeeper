from django.apps import AppConfig


class BookkeeperConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "bookkeeper"
    verbose_name = "Bookkeeper"

    def ready(self):
        import bookkeeper.signals  # noqa: F401
