"""Shared fixtures for Playwright E2E tests."""

import io
import os
import zipfile

# pytest-playwright sets up an asyncio event loop; Django blocks sync ORM
# calls when it detects one. This env var disables that guard for tests.
os.environ.setdefault("DJANGO_ALLOW_ASYNC_UNSAFE", "true")

import pytest
from django.contrib.auth import get_user_model

from bookkeeper.models import Book, BookFormat, Chapter, UserBook

User = get_user_model()

E2E_USERNAME = "e2euser"
E2E_PASSWORD = "e2epassword123"


def _make_minimal_epub() -> bytes:
    """Return a minimal but valid EPUB 2 file as bytes.

    A valid EPUB is a ZIP containing:
      - mimetype (uncompressed, first entry)
      - META-INF/container.xml
      - OEBPS/content.opf
      - OEBPS/chapter1.html
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # mimetype must be uncompressed and the first entry
        zf.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/epub+zip",
            compress_type=zipfile.ZIP_STORED,
        )
        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            "<rootfiles>"
            '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles>"
            "</container>",
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0"'
            ' unique-identifier="bookid">'
            "<metadata>"
            '<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">E2E Test Book</dc:title>'
            '<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Test Author</dc:creator>'
            '<dc:identifier xmlns:dc="http://purl.org/dc/elements/1.1/"'
            ' id="bookid">e2e-test-001</dc:identifier>'
            '<dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">en</dc:language>'
            "</metadata>"
            "<manifest>"
            '<item id="ch1" href="chapter1.html" media-type="application/xhtml+xml"/>'
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
            "</manifest>"
            '<spine toc="ncx"><itemref idref="ch1"/></spine>'
            "</package>",
        )
        zf.writestr(
            "OEBPS/toc.ncx",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
            "<head><meta name=\"dtb:uid\" content=\"e2e-test-001\"/></head>"
            "<docTitle><text>E2E Test Book</text></docTitle>"
            "<navMap>"
            '<navPoint id="ch1" playOrder="1">'
            "<navLabel><text>Chapter 1</text></navLabel>"
            '<content src="chapter1.html"/>'
            "</navPoint>"
            "</navMap>"
            "</ncx>",
        )
        zf.writestr(
            "OEBPS/chapter1.html",
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            "<!DOCTYPE html>"
            "<html><head><title>Chapter 1</title></head>"
            "<body><h1>Chapter One</h1>"
            "<p>This is the first paragraph of the E2E test book. "
            "It contains enough text to make highlighting meaningful.</p>"
            "<p>A second paragraph with more content for testing purposes.</p>"
            "</body></html>",
        )
    return buf.getvalue()


@pytest.fixture(scope="session")
def epub_bytes():
    return _make_minimal_epub()


@pytest.fixture()
def e2e_user(db):
    return User.objects.create_user(
        username=E2E_USERNAME,
        password=E2E_PASSWORD,
    )


@pytest.fixture()
def e2e_book(db, e2e_user, epub_bytes, settings):
    """A real Book with an EPUB file stored in MEDIA_ROOT."""
    import hashlib
    import os

    file_hash = hashlib.sha256(epub_bytes).hexdigest()[:16]
    rel_path = "bookkeeper/books/e2e-test-book.epub"

    # Write the EPUB into MEDIA_ROOT so the reader can serve it
    abs_path = os.path.join(settings.MEDIA_ROOT, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(epub_bytes)

    book = Book.objects.create(
        title="E2E Test Book",
        slug="e2e-test-book",
        author="Test Author",
        format=BookFormat.EPUB,
        file=rel_path,
        file_hash=file_hash,
        page_count=1,
        added_by=e2e_user,
    )
    UserBook.objects.create(user=e2e_user, book=book)

    # Create a Chapter row directly — extraction normally happens at upload
    # time but the test bypasses the upload flow.
    chapter_html = (
        "<h1>Chapter One</h1>"
        "<p>This is the first paragraph of the E2E test book. "
        "It contains enough text to make highlighting meaningful.</p>"
        "<p>A second paragraph with more content for testing purposes.</p>"
    )
    Chapter.objects.create(
        book=book,
        spine_index=0,
        title="Chapter 1",
        html=chapter_html,
        char_count=len(chapter_html),
        content_hash=hashlib.sha256(chapter_html.encode()).hexdigest()[:16],
    )
    return book


@pytest.fixture()
def logged_in_page(page, live_server, e2e_user):
    """A Playwright page with a valid session cookie — no login form needed."""
    from django.test import Client

    client = Client()
    client.login(username=E2E_USERNAME, password=E2E_PASSWORD)
    session_cookie = client.cookies["sessionid"]

    parsed = live_server.url.split("://", 1)[1]  # strip http://
    host = parsed.split(":")[0]

    page.context.add_cookies([{
        "name": "sessionid",
        "value": session_cookie.value,
        "domain": host,
        "path": "/",
    }])
    return page
