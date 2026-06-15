import json
import os

from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.files.base import ContentFile
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils.text import slugify
from django.views.decorators.http import require_POST
from django.views.generic import DetailView, ListView

from . import hooks
from .forms import BookUploadForm
from .models import Book, BookFormat, Bookmark, Highlight, ReaderSettings, ReadingProgress, UserBook
from .readers import ReaderError, get_reader

# ---------------------------------------------------------------------------
# Library views
# ---------------------------------------------------------------------------


class LibraryView(LoginRequiredMixin, ListView):
    template_name = "bookkeeper/library.html"
    context_object_name = "user_books"
    paginate_by = 24

    def get_queryset(self):
        qs = (
            UserBook.objects.filter(user=self.request.user)
            .select_related("book")
            .order_by("-date_last_read", "-date_added")
        )
        q = self.request.GET.get("q", "").strip()
        if q:
            qs = qs.filter(
                book__title__icontains=q
            ) | qs.filter(book__author__icontains=q)
        fmt = self.request.GET.get("format", "")
        if fmt in BookFormat.values:
            qs = qs.filter(book__format=fmt)
        rating = self.request.GET.get("rating", "")
        if rating.isdigit():
            qs = qs.filter(rating=int(rating))
        return qs

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["formats"] = BookFormat.choices
        ctx["query"] = self.request.GET.get("q", "")
        ctx["selected_format"] = self.request.GET.get("format", "")
        ctx["upload_form"] = BookUploadForm()
        return ctx


class BookDetailView(LoginRequiredMixin, DetailView):
    model = Book
    template_name = "bookkeeper/book_detail.html"
    context_object_name = "book"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        book = self.object
        user = self.request.user
        ctx["user_book"], _ = UserBook.objects.get_or_create(user=user, book=book)
        ctx["progress"] = ReadingProgress.objects.filter(user=user, book=book).first()
        ctx["bookmarks"] = Bookmark.objects.filter(user=user, book=book)
        ctx["highlights"] = Highlight.objects.filter(user=user, book=book)
        return ctx


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


@login_required
@require_POST
def upload_book(request):
    form = BookUploadForm(request.POST, request.FILES)
    if not form.is_valid():
        return JsonResponse({"error": form.errors.as_text()}, status=400)

    uploaded = form.cleaned_data["file"]
    fmt = _detect_format(uploaded)
    if not fmt:
        return JsonResponse({"error": "Unsupported file type."}, status=400)

    # Deduplicate by hash
    uploaded.seek(0)
    file_hash = Book.compute_hash(uploaded)
    uploaded.seek(0)

    existing = Book.objects.filter(file_hash=file_hash).first()
    if existing:
        UserBook.objects.get_or_create(user=request.user, book=existing)
        return JsonResponse({"redirect": existing.get_absolute_url()})

    try:
        reader = get_reader(fmt, uploaded)
        meta = reader.extract_metadata()
        cover_data, cover_type = reader.extract_cover()
    except ReaderError as e:
        return JsonResponse({"error": str(e)}, status=400)

    uploaded.seek(0)
    title = form.cleaned_data.get("title") or meta["title"] or uploaded.name
    author = form.cleaned_data.get("author") or meta["author"]

    base_slug = slugify(f"{title}-{author}")[:180] or "book"
    slug = _unique_slug(base_slug)

    book = Book(
        title=title,
        slug=slug,
        author=author,
        description=meta["description"],
        publisher=meta["publisher"],
        published_date=meta["published_date"],
        isbn=meta["isbn"],
        language=meta["language"] or "en",
        format=fmt,
        file_hash=file_hash,
        file_size=uploaded.size,
        page_count=meta["page_count"],
        added_by=request.user,
    )
    book.file.save(uploaded.name, uploaded, save=False)

    if cover_data:
        ext = cover_type.split("/")[-1] if cover_type else "jpg"
        book.cover.save(f"{slug}-cover.{ext}", ContentFile(cover_data), save=False)

    book.save()
    UserBook.objects.create(user=request.user, book=book)
    hooks.book_uploaded.send(sender=Book, user=request.user, book=book)

    return JsonResponse({"redirect": book.get_absolute_url()})


def _detect_format(file_obj):
    name = getattr(file_obj, "name", "")
    ext = os.path.splitext(name)[1].lower().lstrip(".")
    mapping = {"pdf": BookFormat.PDF, "epub": BookFormat.EPUB, "cbz": BookFormat.CBZ}
    return mapping.get(ext)


def _unique_slug(base):
    slug = base
    n = 1
    while Book.objects.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


@login_required
def reader_view(request, slug):
    book = get_object_or_404(Book, slug=slug)
    user_book, _ = UserBook.objects.get_or_create(user=request.user, book=book)
    progress, _ = ReadingProgress.objects.get_or_create(user=request.user, book=book)
    reader_settings, _ = ReaderSettings.objects.get_or_create(user=request.user)

    hooks.book_opened.send(sender=Book, user=request.user, book=book)

    return render(
        request,
        "bookkeeper/reader.html",
        {
            "book": book,
            "user_book": user_book,
            "progress": progress,
            "reader_settings": reader_settings,
            "highlights_json": json.dumps(list(
                Highlight.objects.filter(user=request.user, book=book).values(
                    "id", "start_position", "end_position", "color", "note", "page_number"
                )
            )),
            "bookmarks_json": json.dumps(list(
                Bookmark.objects.filter(user=request.user, book=book).values(
                    "id", "title", "position", "page_number", "note"
                )
            )),
        },
    )


# ---------------------------------------------------------------------------
# API endpoints (called from the reader via fetch)
# ---------------------------------------------------------------------------


@login_required
@require_POST
def api_progress(request, slug):
    book = get_object_or_404(Book, slug=slug)
    data = json.loads(request.body)
    progress, _ = ReadingProgress.objects.get_or_create(user=request.user, book=book)
    progress.position = data.get("position", "")
    progress.page_number = int(data.get("page_number", 1))
    progress.percentage = float(data.get("percentage", 0.0))
    progress.save()

    hooks.progress_updated.send(
        sender=ReadingProgress, user=request.user, book=book, progress=progress
    )
    return JsonResponse({"ok": True})


@login_required
@require_POST
def api_rate(request, slug):
    book = get_object_or_404(Book, slug=slug)
    data = json.loads(request.body)
    rating = int(data.get("rating", 0))
    if rating not in range(0, 6):
        return JsonResponse({"error": "Rating must be 0-5"}, status=400)

    user_book, _ = UserBook.objects.get_or_create(user=request.user, book=book)
    previous = user_book.rating
    user_book.rating = rating or None
    user_book.save(update_fields=["rating"])

    hooks.book_rated.send(
        sender=UserBook, user=request.user, book=book, rating=rating, previous_rating=previous
    )
    return JsonResponse({"ok": True, "rating": rating})


@login_required
@require_POST
def api_highlight_create(request, slug):
    book = get_object_or_404(Book, slug=slug)
    data = json.loads(request.body)
    highlight = Highlight.objects.create(
        user=request.user,
        book=book,
        start_position=data["start_position"],
        end_position=data["end_position"],
        text=data["text"],
        color=data.get("color", "yellow"),
        note=data.get("note", ""),
        page_number=int(data.get("page_number", 1)),
    )
    hooks.highlight_created.send(
        sender=Highlight, user=request.user, book=book, highlight=highlight
    )
    return JsonResponse({"ok": True, "id": highlight.pk})


@login_required
@require_POST
def api_highlight_delete(request, slug, pk):
    highlight = get_object_or_404(Highlight, pk=pk, user=request.user, book__slug=slug)
    highlight.delete()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def api_bookmark_create(request, slug):
    book = get_object_or_404(Book, slug=slug)
    data = json.loads(request.body)
    bookmark = Bookmark.objects.create(
        user=request.user,
        book=book,
        title=data.get("title", ""),
        position=data["position"],
        page_number=int(data.get("page_number", 1)),
        note=data.get("note", ""),
    )
    hooks.bookmark_created.send(sender=Bookmark, user=request.user, book=book, bookmark=bookmark)
    return JsonResponse({"ok": True, "id": bookmark.pk})


@login_required
@require_POST
def api_bookmark_delete(request, slug, pk):
    bookmark = get_object_or_404(Bookmark, pk=pk, user=request.user, book__slug=slug)
    bookmark.delete()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def api_reader_settings(request):
    data = json.loads(request.body)
    settings_obj, _ = ReaderSettings.objects.get_or_create(user=request.user)
    allowed = {"font_size", "font_family", "line_height", "theme", "column_width"}
    for key in allowed:
        if key in data:
            setattr(settings_obj, key, data[key])
    settings_obj.save()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def api_finish(request, slug):
    book = get_object_or_404(Book, slug=slug)
    user_book, _ = UserBook.objects.get_or_create(user=request.user, book=book)
    user_book.is_finished = True
    user_book.save(update_fields=["is_finished"])
    hooks.book_finished.send(sender=UserBook, user=request.user, book=book, user_book=user_book)
    return JsonResponse({"ok": True})


@login_required
@require_POST
def api_favorite(request, slug):
    book = get_object_or_404(Book, slug=slug)
    user_book, _ = UserBook.objects.get_or_create(user=request.user, book=book)
    user_book.is_favorite = not user_book.is_favorite
    user_book.save(update_fields=["is_favorite"])
    return JsonResponse({"ok": True, "is_favorite": user_book.is_favorite})
