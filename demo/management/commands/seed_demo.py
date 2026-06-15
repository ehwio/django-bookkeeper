"""
Management command: seed_demo

Downloads a handful of public-domain EPUBs from Standard Ebooks
(https://standardebooks.org) and Project Gutenberg, then imports them
into the demo library under a pre-created demo user.

Usage:
    python manage.py seed_demo
    python manage.py seed_demo --fast   # skip download if books exist
"""

import hashlib
import io
import urllib.request

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.utils.text import slugify

User = get_user_model()

# ---------------------------------------------------------------------------
# Public-domain books to seed.  All from Standard Ebooks (high-quality EPUBs)
# or Project Gutenberg.  URLs are stable direct download links.
# ---------------------------------------------------------------------------
# All URLs are Project Gutenberg direct cache links — stable and freely accessible.
# Gutenberg IDs: 1342=Pride & Prejudice, 164=20k Leagues, 35=Time Machine,
#                11=Alice, 2147=Pym, 84=Frankenstein
DEMO_BOOKS = [
    {
        "url": "https://www.gutenberg.org/cache/epub/1342/pg1342.epub",
        "title": "Pride and Prejudice",
        "author": "Jane Austen",
        "description": (
            "Elizabeth Bennet navigates love, class, and family in Regency England. "
            "Austen's most beloved novel, first published in 1813."
        ),
    },
    {
        "url": "https://www.gutenberg.org/cache/epub/164/pg164.epub",
        "title": "Twenty Thousand Leagues Under the Seas",
        "author": "Jules Verne",
        "description": (
            "Professor Aronnax is swept into a fantastic undersea voyage aboard "
            "the Nautilus, commanded by the mysterious Captain Nemo."
        ),
    },
    {
        "url": "https://www.gutenberg.org/cache/epub/35/pg35.epub",
        "title": "The Time Machine",
        "author": "H.G. Wells",
        "description": (
            "A Victorian scientist travels to the far future and discovers "
            "the fate of humanity in this pioneering work of science fiction."
        ),
    },
    {
        "url": "https://www.gutenberg.org/cache/epub/11/pg11.epub",
        "title": "Alice's Adventures in Wonderland",
        "author": "Lewis Carroll",
        "description": (
            "Alice tumbles down a rabbit hole into a fantastical world of "
            "talking animals, mad hatters, and curious logic."
        ),
    },
    {
        "url": "https://www.gutenberg.org/cache/epub/84/pg84.epub",
        "title": "Frankenstein",
        "author": "Mary Wollstonecraft Shelley",
        "description": (
            "The story of Victor Frankenstein's obsessive quest to create life "
            "and the creature who haunts him — a landmark of Gothic fiction."
        ),
    },
]


class Command(BaseCommand):
    help = "Seed the demo database with a user and public-domain books."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fast",
            action="store_true",
            help="Skip books that are already in the database.",
        )
        parser.add_argument(
            "--user",
            default="demo",
            help="Username for the demo account (default: demo).",
        )
        parser.add_argument(
            "--password",
            default="demo",
            help="Password for the demo account (default: demo).",
        )

    def handle(self, *args, **options):
        from bookkeeper.models import Book, BookFormat, UserBook
        from bookkeeper.readers import get_reader

        username = options["user"]
        password = options["password"]

        # ── Create / update demo user ─────────────────────────────────────
        user, created = User.objects.get_or_create(username=username)
        user.set_password(password)
        user.first_name = "Demo"
        user.last_name = "Reader"
        user.save()

        if created:
            self.stdout.write(self.style.SUCCESS(f"Created user '{username}'"))
        else:
            self.stdout.write(f"User '{username}' already exists — password reset.")

        # ── Download & import books ───────────────────────────────────────
        imported = 0
        skipped = 0

        for book_meta in DEMO_BOOKS:
            title = book_meta["title"]

            if options["fast"] and Book.objects.filter(title=title).exists():
                self.stdout.write(f"  SKIP  {title}")
                skipped += 1
                continue

            self.stdout.write(f"  ↓     {title} …", ending="")
            self.stdout.flush()

            try:
                epub_bytes = self._download(book_meta["url"])
            except Exception as e:
                self.stdout.write(self.style.WARNING(f" download failed: {e}"))
                continue

            file_hash = hashlib.sha256(epub_bytes).hexdigest()

            existing = Book.objects.filter(file_hash=file_hash).first()
            if existing:
                UserBook.objects.get_or_create(user=user, book=existing)
                self.stdout.write(self.style.WARNING(" already in DB, linked."))
                skipped += 1
                continue

            # Parse metadata & cover via the epub reader
            file_obj = _BytesFileWrapper(epub_bytes, name=f"{slugify(title)}.epub")
            try:
                reader = get_reader(BookFormat.EPUB, file_obj)
                meta = reader.extract_metadata()
                cover_data, cover_type = reader.extract_cover()
            except Exception as e:
                self.stdout.write(self.style.WARNING(f" parse error: {e}"))
                continue

            # Override with our curated metadata
            slug = _unique_slug(slugify(f"{book_meta['author']}-{title}")[:180] or "book")

            book = Book(
                title=book_meta["title"],
                slug=slug,
                author=book_meta["author"],
                description=book_meta["description"],
                format=BookFormat.EPUB,
                file_hash=file_hash,
                file_size=len(epub_bytes),
                page_count=meta.get("page_count", 0),
                added_by=user,
            )
            file_obj.seek(0)
            book.file.save(f"{slug}.epub", file_obj, save=False)

            if cover_data:
                ext = (cover_type or "image/jpeg").split("/")[-1]
                book.cover.save(f"{slug}-cover.{ext}", ContentFile(cover_data), save=False)

            book.save()
            UserBook.objects.create(user=user, book=book)
            imported += 1
            self.stdout.write(self.style.SUCCESS(" done"))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Seeding complete: {imported} imported, {skipped} skipped."
        ))
        self.stdout.write(
            f"\nStart the server and visit http://127.0.0.1:8000/\n"
            f"  username: {username}\n"
            f"  password: {password}\n"
        )

    @staticmethod
    def _download(url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": "django-bookkeeper-demo/0.1"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()


class _BytesFileWrapper(io.BytesIO):
    """BytesIO with a .name attribute and .chunks() for Django file handling."""

    def __init__(self, data: bytes, name: str):
        super().__init__(data)
        self.name = name
        self.size = len(data)

    def chunks(self, chunk_size=65536):
        self.seek(0)
        while True:
            chunk = self.read(chunk_size)
            if not chunk:
                break
            yield chunk


def _unique_slug(base: str) -> str:
    from bookkeeper.models import Book
    slug, n = base, 1
    while Book.objects.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug
