import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from bookkeeper.models import (
    Book,
    BookFormat,
    Bookmark,
    ReadingProgress,
    UserBook,
)

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="reader", password="pass")


@pytest.fixture
def another_user(db):
    return User.objects.create_user(username="other", password="pass")


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
# POST /api/book/<slug>/progress/ — save reading progress
# ---------------------------------------------------------------------------

class TestProgress:
    def test_happy_path(self, authenticated_client, user, book):
        payload = {
            "position": "epubcfi(/4/2/10)",
            "page_number": 5,
            "percentage": 4.5,
        }
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/progress/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        rp = ReadingProgress.objects.get(user=user, book=book)
        assert rp.position == "epubcfi(/4/2/10)"
        assert rp.page_number == 5
        assert rp.percentage == 4.5

    def test_idempotent_second_post_updates(self, authenticated_client, user, book):
        """Second POST should update the existing row, not create a duplicate."""
        payload1 = {"position": "epubcfi(/4/2)", "page_number": 1, "percentage": 1.0}
        payload2 = {"position": "epubcfi(/4/4)", "page_number": 2, "percentage": 2.0}

        authenticated_client.post(
            f"/books/api/book/{book.slug}/progress/",
            data=json.dumps(payload1),
            content_type="application/json",
        )
        authenticated_client.post(
            f"/books/api/book/{book.slug}/progress/",
            data=json.dumps(payload2),
            content_type="application/json",
        )

        assert ReadingProgress.objects.filter(user=user, book=book).count() == 1
        rp = ReadingProgress.objects.get(user=user, book=book)
        assert rp.position == "epubcfi(/4/4)"
        assert rp.page_number == 2
        assert rp.percentage == 2.0

    def test_defaults(self, authenticated_client, user, book):
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/progress/",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert response.status_code == 200
        rp = ReadingProgress.objects.get(user=user, book=book)
        assert rp.position == ""
        assert rp.page_number == 1
        assert rp.percentage == 0.0

    def test_auth_required(self, client, book):
        payload = {"position": "epubcfi(/4/2)", "page_number": 1, "percentage": 1.0}
        response = client.post(
            f"/books/api/book/{book.slug}/progress/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/progress/"
        )
        assert response.status_code == 405


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/bookmark/ — create bookmark
# ---------------------------------------------------------------------------

class TestBookmarkCreate:
    def test_happy_path(self, authenticated_client, user, book):
        payload = {
            "title": "Chapter 3",
            "position": "epubcfi(/4/2)",
            "page_number": 30,
            "note": "Important passage",
        }
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/bookmark/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data == {"ok": True, "id": 1}
        bm = Bookmark.objects.get(pk=1)
        assert bm.title == "Chapter 3"
        assert bm.position == "epubcfi(/4/2)"
        assert bm.page_number == 30
        assert bm.note == "Important passage"

    def test_minimal_payload(self, authenticated_client, book):
        payload = {"position": "epubcfi(/4/2)"}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/bookmark/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        bm = Bookmark.objects.get(pk=response.json()["id"])
        assert bm.title == ""
        assert bm.note == ""
        assert bm.page_number == 1

    def test_auth_required(self, client, book):
        payload = {"position": "epubcfi(/4/2)"}
        response = client.post(
            f"/books/api/book/{book.slug}/bookmark/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/bookmark/"
        )
        assert response.status_code == 405

    def test_missing_position(self, authenticated_client, book):
        payload = {"title": "No position"}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/bookmark/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/finish/ — mark book as finished
# ---------------------------------------------------------------------------

class TestFinish:
    def test_happy_path(self, authenticated_client, user, book):
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/finish/"
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        ub = UserBook.objects.get(user=user, book=book)
        assert ub.is_finished is True

    def test_idempotent(self, authenticated_client, user, book):
        """Second POST should not raise an error."""
        authenticated_client.post(f"/books/api/book/{book.slug}/finish/")
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/finish/"
        )
        assert response.status_code == 200
        # Only one UserBook row should exist for this user+book
        assert UserBook.objects.filter(user=user, book=book).count() == 1

    def test_auth_required(self, client, book):
        response = client.post(f"/books/api/book/{book.slug}/finish/")
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(f"/books/api/book/{book.slug}/finish/")
        assert response.status_code == 405
