"""Tests for the book upload and ingest pipeline (issue #79).

Fixture files are generated in memory — no disk fixtures required.
All tests use the Django test client; no browser needed.
"""

import io
import zipfile

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse

from bookkeeper.models import Book, Chapter, UserBook

User = get_user_model()

UPLOAD_URL = reverse("bookkeeper:upload")


# ---------------------------------------------------------------------------
# Fixture file generators
# ---------------------------------------------------------------------------

def _make_epub(title="Upload Test Book", author="Upload Author") -> bytes:
    """Minimal valid EPUB 2 with the given title/author in the OPF metadata."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/epub+zip",
            compress_type=zipfile.ZIP_STORED,
        )
        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0"'
            ' xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            "<rootfiles>"
            '<rootfile full-path="OEBPS/content.opf"'
            ' media-type="application/oebps-package+xml"/>'
            "</rootfiles></container>",
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0"'
            ' unique-identifier="uid"><metadata>'
            f'<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">{title}</dc:title>'
            f'<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">{author}</dc:creator>'
            '<dc:identifier xmlns:dc="http://purl.org/dc/elements/1.1/"'
            ' id="uid">test-upload-001</dc:identifier>'
            '<dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">en</dc:language>'
            "</metadata>"
            "<manifest>"
            '<item id="ch1" href="chapter1.html" media-type="application/xhtml+xml"/>'
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
            "</manifest>"
            '<spine toc="ncx"><itemref idref="ch1"/></spine></package>',
        )
        zf.writestr(
            "OEBPS/toc.ncx",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
            '<head><meta name="dtb:uid" content="test-upload-001"/></head>'
            "<docTitle><text>Test</text></docTitle>"
            "<navMap>"
            '<navPoint id="ch1" playOrder="1">'
            "<navLabel><text>Chapter 1</text></navLabel>"
            '<content src="chapter1.html"/></navPoint>'
            "</navMap></ncx>",
        )
        zf.writestr(
            "OEBPS/chapter1.html",
            "<!DOCTYPE html><html><head><title>Ch1</title></head>"
            "<body><p>Upload pipeline test content.</p></body></html>",
        )
    return buf.getvalue()


def _make_pdf() -> bytes:
    """Minimal valid single-page PDF (no graphics, just the required structure)."""
    # Hand-crafted PDF that PyMuPDF can open without error.
    body = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R"
        b" /MediaBox [0 0 612 792] >>\nendobj\n"
    )
    xref_offset = len(body)
    xref = (
        b"xref\n0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
    )
    trailer = (
        b"trailer\n<< /Size 4 /Root 1 0 R >>\n"
        b"startxref\n" + str(xref_offset).encode() + b"\n%%EOF\n"
    )
    return body + xref + trailer


def _make_cbz() -> bytes:
    """Minimal CBZ: a ZIP containing one tiny 1×1 JPEG."""
    # Smallest valid JFIF JPEG (1×1 white pixel)
    tiny_jpeg = (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
        b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
        b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
        b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
        b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00"
        b"\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
        b"\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04"
        b"\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa"
        b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd4P\x00\x00\x00\xff\xd9"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("page001.jpg", tiny_jpeg)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def user(db):
    return User.objects.create_user(username="uploader", password="pass")


@pytest.fixture
def auth_client(user):
    c = Client()
    c.login(username="uploader", password="pass")
    return c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_upload_requires_login(db):
    resp = Client().post(UPLOAD_URL, {})
    assert resp.status_code == 302
    assert "/login" in resp["Location"] or "login" in resp["Location"]


@pytest.mark.django_db
def test_upload_epub_creates_book(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    epub = _make_epub(title="Upload Test Book", author="Upload Author")

    resp = auth_client.post(
        UPLOAD_URL,
        {"file": _django_upload(epub, "test.epub", "application/epub+zip")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert "redirect" in data

    book = Book.objects.get()
    assert book.title == "Upload Test Book"
    assert book.author == "Upload Author"
    assert UserBook.objects.filter(book=book).count() == 1
    assert Chapter.objects.filter(book=book).count() >= 1


@pytest.mark.django_db
def test_upload_pdf_creates_book(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    resp = auth_client.post(
        UPLOAD_URL,
        {"file": _django_upload(_make_pdf(), "test.pdf", "application/pdf")},
    )
    assert resp.status_code == 200
    assert "redirect" in resp.json()
    assert Book.objects.filter(format="pdf").count() == 1


@pytest.mark.django_db
def test_upload_cbz_creates_book(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    resp = auth_client.post(
        UPLOAD_URL,
        {"file": _django_upload(_make_cbz(), "test.cbz", "application/zip")},
    )
    assert resp.status_code == 200
    assert "redirect" in resp.json()
    assert Book.objects.filter(format="cbz").count() == 1


@pytest.mark.django_db
def test_upload_unsupported_type_rejected(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    resp = auth_client.post(
        UPLOAD_URL,
        {"file": _django_upload(b"not a book", "notes.txt", "text/plain")},
    )
    assert resp.status_code == 400
    assert "error" in resp.json()


@pytest.mark.django_db
def test_upload_duplicate_returns_existing_book(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    epub = _make_epub()
    upload = lambda: auth_client.post(  # noqa: E731
        UPLOAD_URL,
        {"file": _django_upload(epub, "test.epub", "application/epub+zip")},
    )

    r1 = upload()
    assert r1.status_code == 200
    assert Book.objects.count() == 1
    book_url = r1.json()["redirect"]

    r2 = upload()
    assert r2.status_code == 200
    assert r2.json()["redirect"] == book_url
    assert Book.objects.count() == 1  # no duplicate


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _django_upload(data: bytes, name: str, content_type: str):
    """Wrap bytes in a Django SimpleUploadedFile-compatible object."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    return SimpleUploadedFile(name, data, content_type=content_type)
