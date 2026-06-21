"""
Management command: create_admin

Creates a superuser for the demo admin interface. If the user already
exists, their password is updated. Useful for setting up the demo
after running migrations.

Usage:
    python manage.py create_admin
    python manage.py create_admin --username admin --password secret
"""

import getpass

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

User = get_user_model()


class Command(BaseCommand):
    help = "Create a superuser for the demo admin interface"

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            type=str,
            default=None,
            help="Admin username (default: prompt)",
        )
        parser.add_argument(
            "--password",
            type=str,
            default=None,
            help="Admin password (default: prompt, hidden input)",
        )
        parser.add_argument(
            "--email",
            type=str,
            default="",
            help="Admin email (default: empty)",
        )

    def handle(self, *args, **options):
        username = options["username"]
        password = options["password"]
        email = options["email"]

        if not username:
            username = input("Username: ").strip()
        if not username:
            raise CommandError("Username cannot be empty")

        if not password:
            password = getpass.getpass("Password: ")
        if not password:
            raise CommandError("Password cannot be empty")

        user, created = User.objects.update_or_create(
            username=username,
            defaults={"is_staff": True, "is_superuser": True, "email": email},
        )
        user.set_password(password)
        user.save()

        if created:
            self.stdout.write(
                self.style.SUCCESS(f"Admin user '{username}' created.")
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(f"Admin user '{username}' updated.")
            )
