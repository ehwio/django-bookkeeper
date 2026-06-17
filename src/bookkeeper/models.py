import hashlib
import os

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


def book_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    return f"bookkeeper/books/{instance.slug}{ext}"


def cover_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    return f"bookkeeper/covers/{instance.slug}{ext}"


def user_cover_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    return f"bookkeeper/covers/user_{instance.user_id}/{instance.book.slug}{ext}"


class BookFormat(models.TextChoices):
    PDF = "pdf", _("PDF")
    EPUB = "epub", _("EPUB")
    CBZ = "cbz", _("CBZ / Comic Book Archive")
    CBR = "cbr", _("CBR / Comic Book Archive (RAR)")


class Book(models.Model):
    """A book in the library. Shared across all users."""

    title = models.CharField(max_length=500)
    slug = models.SlugField(max_length=200, unique=True)
    author = models.CharField(max_length=500, blank=True)
    description = models.TextField(blank=True)
    publisher = models.CharField(max_length=300, blank=True)
    published_date = models.CharField(max_length=50, blank=True)
    isbn = models.CharField(max_length=20, blank=True, db_index=True)
    language = models.CharField(max_length=10, default="en")

    format = models.CharField(max_length=10, choices=BookFormat.choices)
    file = models.FileField(upload_to=book_upload_path)
    file_hash = models.CharField(max_length=64, unique=True, db_index=True)
    file_size = models.PositiveBigIntegerField(default=0)
    page_count = models.PositiveIntegerField(default=0)

    cover = models.ImageField(upload_to=cover_upload_path, blank=True, null=True)

    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="uploaded_books",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["title", "author"]
        indexes = [
            models.Index(fields=["title"]),
            models.Index(fields=["author"]),
            models.Index(fields=["format"]),
        ]

    def __str__(self):
        return f"{self.title} — {self.author}" if self.author else self.title

    def get_absolute_url(self):
        from django.urls import reverse
        return reverse("bookkeeper:book_detail", kwargs={"slug": self.slug})

    def get_reader_url(self):
        from django.urls import reverse
        return reverse("bookkeeper:reader", kwargs={"slug": self.slug})

    @staticmethod
    def compute_hash(file_obj):
        h = hashlib.sha256()
        for chunk in file_obj.chunks():
            h.update(chunk)
        return h.hexdigest()


class Chapter(models.Model):
    """
    A single spine item from an EPUB, stored as sanitized HTML.
    Populated at upload time; replaces epub.js rendering for reflowable EPUBs.
    """

    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="chapters")
    spine_index = models.PositiveIntegerField()
    title = models.CharField(max_length=500, blank=True)
    html = models.TextField()
    char_count = models.PositiveIntegerField(default=0)
    # Short hash of extracted HTML — lets us detect when offsets are stale
    content_hash = models.CharField(max_length=16)

    class Meta:
        ordering = ["spine_index"]
        unique_together = [("book", "spine_index")]

    def __str__(self):
        return f"{self.book} — ch.{self.spine_index} {self.title}"


class UserBook(models.Model):
    """Per-user relationship to a book: rating, dates, etc."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="user_books"
    )
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="user_books")

    rating = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        choices=[(i, "★" * i) for i in range(1, 6)],
    )
    date_added = models.DateTimeField(auto_now_add=True)
    date_last_read = models.DateTimeField(null=True, blank=True)
    is_favorite = models.BooleanField(default=False)
    is_finished = models.BooleanField(default=False)
    cover_override = models.ImageField(upload_to=user_cover_upload_path, blank=True, null=True)

    class Meta:
        unique_together = ("user", "book")
        ordering = ["-date_last_read", "-date_added"]

    def __str__(self):
        return f"{self.user} / {self.book}"

    @property
    def effective_cover_url(self):
        """Return per-user override URL if set, otherwise fall back to the book's cover."""
        if self.cover_override:
            return self.cover_override.url
        if self.book.cover:
            return self.book.cover.url
        return None


class ReadingProgress(models.Model):
    """Tracks the current reading position for a user+book."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reading_progress"
    )
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="reading_progress")

    # Generic position: CFI for EPUB, page number for PDF, page index for CBZ
    position = models.TextField(blank=True)
    page_number = models.PositiveIntegerField(default=1)
    percentage = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "book")

    def __str__(self):
        return f"{self.user} / {self.book} @ {self.percentage:.1f}%"


class Bookmark(models.Model):
    """A named position saved by a user within a book."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookmarks"
    )
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="bookmarks")

    title = models.CharField(max_length=300, blank=True)
    position = models.TextField()
    page_number = models.PositiveIntegerField(default=1)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["book", "page_number"]

    def __str__(self):
        return f"{self.title or 'Bookmark'} in {self.book} (p.{self.page_number})"


class HighlightColor(models.TextChoices):
    YELLOW = "yellow", _("Yellow")
    GREEN = "green", _("Green")
    BLUE = "blue", _("Blue")
    PINK = "pink", _("Pink")
    ORANGE = "orange", _("Orange")


class Highlight(models.Model):
    """A text highlight made by a user within a book."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="highlights"
    )
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="highlights")

    # For EPUB: CFI range; for PDF: structured position data
    start_position = models.TextField()
    end_position = models.TextField()
    text = models.TextField()
    color = models.CharField(
        max_length=20, choices=HighlightColor.choices, default=HighlightColor.YELLOW
    )
    note = models.TextField(blank=True)
    page_number = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["book", "page_number", "start_position"]

    def __str__(self):
        snippet = self.text[:50] + ("…" if len(self.text) > 50 else "")
        return f'"{snippet}" in {self.book}'


class ReaderSettings(models.Model):
    """Per-user reader preferences."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reader_settings"
    )

    font_size = models.PositiveSmallIntegerField(default=16)
    font_family = models.CharField(
        max_length=50,
        default="serif",
        choices=[
            ("serif", "Serif"),
            ("sans-serif", "Sans-serif"),
            ("monospace", "Monospace"),
            ("Georgia, serif", "Georgia"),
            ("'Palatino Linotype', serif", "Palatino"),
            ("'Open Sans', sans-serif", "Open Sans"),
        ],
    )
    line_height = models.FloatField(default=1.6)
    theme = models.CharField(
        max_length=20,
        default="light",
        choices=[("light", "Light"), ("sepia", "Sepia"), ("dark", "Dark")],
    )
    column_width = models.CharField(
        max_length=20,
        default="normal",
        choices=[("narrow", "Narrow"), ("normal", "Normal"), ("wide", "Wide")],
    )

    class Meta:
        verbose_name_plural = "reader settings"

    def __str__(self):
        return f"Reader settings for {self.user}"
