import io
import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from bookkeeper.models import Book, BookFormat, UserBook

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="reader", password="pass")


@pytest.fixture
def book(db, user):
    return Book.objects.create(
        title="Test Book",
        slug="test-book",
        author="Test Author",
        format=BookFormat.EPUB,
        file="bookkeeper/books/test-book.epub",
        file_hash="abc123",
        page_count=100,
        added_by=user,
    )


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def authenticated_client(client, user):
    client.force_login(user)
    return client


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/favorite/ — toggle is_favorite
# ---------------------------------------------------------------------------

class TestFavorite:
    def test_toggle_on(self, authenticated_client, user, book):
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/favorite/"
        )
        assert response.status_code == 200
        data = response.json()
        assert data == {"ok": True, "is_favorite": True}
        ub = UserBook.objects.get(user=user, book=book)
        assert ub.is_favorite is True

    def test_toggle_off(self, authenticated_client, user, book):
        # Ensure already favorited
        UserBook.objects.create(user=user, book=book, is_favorite=True)
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/favorite/"
        )
        assert response.status_code == 200
        data = response.json()
        assert data == {"ok": True, "is_favorite": False}
        ub = UserBook.objects.get(user=user, book=book)
        assert ub.is_favorite is False

    def test_auth_required(self, client, book):
        response = client.post(f"/books/api/book/{book.slug}/favorite/")
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/favorite/"
        )
        assert response.status_code == 405


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/delete/ — remove book from user's library
# ---------------------------------------------------------------------------

class TestDelete:
    def test_happy_path(self, authenticated_client, user, book):
        UserBook.objects.create(user=user, book=book)
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/delete/"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert "redirect" in data
        assert data["redirect"] == "/books/"
        assert UserBook.objects.filter(user=user, book=book).count() == 0

    def test_book_not_in_library(self, authenticated_client, user, book):
        """Deleting a book not in the user's library returns 404."""
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/delete/"
        )
        assert response.status_code == 404

    def test_auth_required(self, client, book):
        response = client.post(f"/books/api/book/{book.slug}/delete/")
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/delete/"
        )
        assert response.status_code == 405


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/cover/ — upload cover image (multipart)
# ---------------------------------------------------------------------------

class TestCover:
    def test_happy_path(self, authenticated_client, user, book):
        UserBook.objects.create(user=user, book=book)
        img = io.BytesIO(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01")
        img.name = "cover.png"
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/cover/",
            data={"cover": img},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert "cover_url" in data
        ub = UserBook.objects.get(user=user, book=book)
        assert ub.cover_override is not None

    def test_unsupported_format(self, authenticated_client, user, book):
        UserBook.objects.create(user=user, book=book)
        txt = io.BytesIO(b"not an image")
        txt.name = "cover.txt"
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/cover/",
            data={"cover": txt},
        )
        assert response.status_code == 400
        assert "Unsupported image type" in response.json()["error"]

    def test_no_file(self, authenticated_client, user, book):
        UserBook.objects.create(user=user, book=book)
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/cover/",
            data={},
        )
        assert response.status_code == 400
        assert "No file provided" in response.json()["error"]

    def test_auth_required(self, client, book):
        img = io.BytesIO(b"\x89PNG\r\n\x1a\n")
        img.name = "cover.png"
        response = client.post(
            f"/books/api/book/{book.slug}/cover/",
            data={"cover": img},
        )
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/cover/"
        )
        assert response.status_code == 405


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/rate/ — rate a book
# ---------------------------------------------------------------------------

class TestRate:
    def test_happy_path(self, authenticated_client, user, book):
        payload = {"rating": 4}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/rate/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data == {"ok": True, "rating": 4}
        ub = UserBook.objects.get(user=user, book=book)
        assert ub.rating == 4

    def test_zero_clears_rating(self, authenticated_client, user, book):
        UserBook.objects.create(user=user, book=book, rating=5)
        payload = {"rating": 0}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/rate/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        assert response.json()["rating"] == 0
        ub = UserBook.objects.get(user=user, book=book)
        assert ub.rating is None

    def test_invalid_rating(self, authenticated_client, book):
        payload = {"rating": 6}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/rate/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 400
        assert "Rating must be 0-5" in response.json()["error"]

    def test_auth_required(self, client, book):
        payload = {"rating": 3}
        response = client.post(
            f"/books/api/book/{book.slug}/rate/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/rate/"
        )
        assert response.status_code == 405
