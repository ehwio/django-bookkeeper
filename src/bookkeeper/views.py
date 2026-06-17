import contextlib
import json
import os
import re

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.files.base import ContentFile
from django.http import HttpResponse, JsonResponse
from django.core.exceptions import PermissionDenied
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.text import slugify
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.views.generic import DetailView, ListView

from . import hooks
from .forms import BookMetadataForm, BookUploadForm
from .models import (
    Book,
    BookFormat,
    Bookmark,
    Chapter,
    Highlight,
    ReaderSettings,
    ReadingProgress,
    Snippet,
    UserBook,
)
from .readers import ReaderError, get_reader
from .readers.epub import IMG_PLACEHOLDER_PREFIX

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
        ctx["snippets"] = Snippet.objects.filter(user=user, book=book)
        return ctx


@login_required
def book_edit(request, slug):
    """Handle metadata form submission for a book."""
    book = get_object_or_404(Book, slug=slug)
    if book.added_by != request.user:
        raise PermissionDenied
    saved = False
    if request.method == "POST":
        form = BookMetadataForm(request.POST, instance=book)
        if form.is_valid():
            form.save()
            return redirect(f"{reverse('bookkeeper:book_edit', args=[slug])}?saved=1")
    else:
        saved = request.GET.get("saved") == "1"
        form = BookMetadataForm(instance=book)
    return render(request, "bookkeeper/book_edit.html", {"book": book, "form": form, "saved": saved})


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

    if fmt == BookFormat.EPUB and not reader.is_fixed_layout():
        _extract_epub_chapters(book, reader)

    hooks.book_uploaded.send(sender=Book, user=request.user, book=book)

    return JsonResponse({"redirect": book.get_absolute_url()})


def _detect_format(file_obj):
    name = getattr(file_obj, "name", "")
    ext = os.path.splitext(name)[1].lower().lstrip(".")
    mapping = {
        "pdf": BookFormat.PDF, "epub": BookFormat.EPUB,
        "cbz": BookFormat.CBZ, "cbr": BookFormat.CBR,
    }
    return mapping.get(ext)


def _unique_slug(base):
    slug = base
    n = 1
    while Book.objects.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _extract_epub_chapters(book, reader):
    """Save extracted chapter HTML and images for a freshly uploaded EPUB."""
    images = reader.extract_images()

    # Save images to MEDIA_ROOT and build a placeholder → URL map
    image_url_map: dict[str, str] = {}
    for epub_path, (img_bytes, _media_type) in images.items():
        # Flatten path: OEBPS/Images/fig.png → OEBPS__Images__fig.png
        safe_name = epub_path.replace("/", "__")
        storage_rel = f"bookkeeper/book-images/{book.slug}/{safe_name}"
        full_path = os.path.join(settings.MEDIA_ROOT, storage_rel)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as fh:
            fh.write(img_bytes)
        image_url_map[epub_path] = settings.MEDIA_URL + storage_rel

    placeholder_re = re.compile(
        re.escape(IMG_PLACEHOLDER_PREFIX) + r"([^\s\"']+)"
    )

    def _replace_img(m: re.Match) -> str:
        return image_url_map.get(m.group(1), "")

    chapters_data = reader.extract_chapters()
    to_create = []
    for i, ch in enumerate(chapters_data):
        html = placeholder_re.sub(_replace_img, ch["html"])
        to_create.append(Chapter(
            book=book,
            spine_index=i,
            title=ch["title"],
            html=html,
            char_count=ch["char_count"],
            content_hash=ch["content_hash"],
        ))
    Chapter.objects.bulk_create(to_create)


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

    all_chapters = list(book.chapters.order_by("spine_index")) if book.format == "epub" else []
    has_chapters = bool(all_chapters)

    # Determine which chapter to open from saved position ("chapter_index:char_offset")
    initial_chapter_index = 0
    if has_chapters and progress.position and ":" in progress.position:
        with contextlib.suppress(ValueError, IndexError):
            initial_chapter_index = min(
                int(progress.position.split(":")[0]),
                len(all_chapters) - 1,
            )

    return render(
        request,
        "bookkeeper/reader.html",
        {
            "book": book,
            "user_book": user_book,
            "progress": progress,
            "reader_settings": reader_settings,
            "has_chapters": has_chapters,
            "chapter_count": len(all_chapters),
            "initial_chapter_index": initial_chapter_index,
            "all_chapters": all_chapters,
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
            "snippets_json": json.dumps(list(
                Snippet.objects.filter(user=request.user, book=book).values(
                    "id", "title", "text", "note", "page_number", "position", "created_at"
                )
            ), default=str),
        },
    )


# ---------------------------------------------------------------------------
# API endpoints (called from the reader via fetch)
# ---------------------------------------------------------------------------


@csrf_exempt
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
def api_snippet_create(request, slug):
    book = get_object_or_404(Book, slug=slug)
    data = json.loads(request.body)
    snippet = Snippet.objects.create(
        user=request.user,
        book=book,
        title=data.get("title", ""),
        text=data["text"],
        note=data.get("note", ""),
        page_number=int(data.get("page_number", 1)),
        position=data.get("position", ""),
    )
    hooks.snippet_created.send(
        sender=Snippet, user=request.user, book=book, snippet=snippet
    )
    return JsonResponse({"ok": True, "id": snippet.pk})


@login_required
@require_POST
def api_snippet_delete(request, slug, pk):
    snippet = get_object_or_404(Snippet, pk=pk, user=request.user, book__slug=slug)
    snippet.delete()
    return JsonResponse({"ok": True})


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


@login_required
@require_POST
def api_delete(request, slug):
    """Remove a book from the current user's library (deletes the UserBook row)."""
    book = get_object_or_404(Book, slug=slug)
    user_book = get_object_or_404(UserBook, user=request.user, book=book)
    user_book.delete()
    return JsonResponse({"ok": True, "redirect": reverse("bookkeeper:library")})


@login_required
@require_POST
def api_cover(request, slug):
    book = get_object_or_404(Book, slug=slug)
    user_book, _ = UserBook.objects.get_or_create(user=request.user, book=book)
    file = request.FILES.get("cover")
    if not file:
        return JsonResponse({"ok": False, "error": "No file provided."}, status=400)
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        return JsonResponse({"ok": False, "error": "Unsupported image type."}, status=400)
    if user_book.cover_override:
        user_book.cover_override.delete(save=False)
    user_book.cover_override.save(file.name, file, save=False)
    user_book.save(update_fields=["cover_override"])
    return JsonResponse({"ok": True, "cover_url": user_book.cover_override.url})


@login_required
def api_comic_page(request, slug, index):
    """Serve a single page image from a CBR (or CBZ) archive by page index."""
    book = get_object_or_404(Book, slug=slug)
    reader = get_reader(book.format, book.file)
    pages = reader._pages
    if index < 0 or index >= len(pages):
        return HttpResponse(status=404)
    name = pages[index]
    data = reader._read(name) if book.format == BookFormat.CBR else reader._zf.read(name)
    ext = name.rsplit(".", 1)[-1].lower()
    content_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    response = HttpResponse(data, content_type=content_type)
    response["X-Page-Count"] = str(len(pages))
    return response


# ---------------------------------------------------------------------------
@login_required
def api_chapter(request, slug, index):
    book = get_object_or_404(Book, slug=slug)
    chapter = get_object_or_404(Chapter, book=book, spine_index=index)
    total = book.chapters.count()
    return JsonResponse({
        "html": chapter.html,
        "title": chapter.title,
        "spine_index": chapter.spine_index,
        "char_count": chapter.char_count,
        "content_hash": chapter.content_hash,
        "total": total,
        "has_prev": chapter.spine_index > 0,
        "has_next": chapter.spine_index < total - 1,
    })


# Chapter eval view (feature/epub-extraction only)
# Renders extracted chapter HTML directly so we can assess quality before
# wiring the full reader to this path.
# ---------------------------------------------------------------------------


@login_required
def chapter_eval(request, slug, index):
    book = get_object_or_404(Book, slug=slug)
    chapters = list(book.chapters.all())
    if not chapters:
        return render(request, "bookkeeper/chapter_eval.html", {
            "book": book, "chapter": None, "chapters": [],
            "prev_index": None, "next_index": None,
        })
    index = max(0, min(index, len(chapters) - 1))
    chapter = chapters[index]
    return render(request, "bookkeeper/chapter_eval.html", {
        "book": book,
        "chapter": chapter,
        "chapters": chapters,
        "prev_index": index - 1 if index > 0 else None,
        "next_index": index + 1 if index < len(chapters) - 1 else None,
    })
