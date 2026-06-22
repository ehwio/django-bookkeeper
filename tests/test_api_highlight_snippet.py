import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from bookkeeper.models import Book, BookFormat, Highlight, Snippet

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
# POST /api/book/<slug>/highlight/ — create
# ---------------------------------------------------------------------------

class TestHighlightCreate:
    def test_happy_path(self, authenticated_client, book):
        payload = {
            "start_position": "epubcfi(/4/2)",
            "end_position": "epubcfi(/4/4)",
            "text": "A highlighted passage",
            "color": "yellow",
            "note": "Important!",
            "page_number": 5,
        }
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data == {"ok": True, "id": 1}
        hl = Highlight.objects.get(pk=1)
        assert hl.text == "A highlighted passage"
        assert hl.color == "yellow"
        assert hl.note == "Important!"
        assert hl.page_number == 5

    def test_defaults_color_and_note(self, authenticated_client, book):
        payload = {
            "start_position": "epubcfi(/4/2)",
            "end_position": "epubcfi(/4/4)",
            "text": "Plain highlight",
            "page_number": 1,
        }
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        hl = Highlight.objects.get(pk=response.json()["id"])
        assert hl.color == "yellow"
        assert hl.note == ""

    def test_auth_required(self, client, book):
        payload = {"start_position": "a", "end_position": "b", "text": "hi"}
        response = client.post(
            f"/books/api/book/{book.slug}/highlight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(f"/books/api/book/{book.slug}/highlight/")
        assert response.status_code == 405

    def test_missing_required_field(self, authenticated_client, book):
        payload = {"start_position": "epubcfi(/4/2)"}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_missing_text(self, authenticated_client, book):
        payload = {"start_position": "a", "end_position": "b"}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/highlight/<pk>/delete/ — delete
# ---------------------------------------------------------------------------

class TestHighlightDelete:
    def test_happy_path(self, authenticated_client, user, book):
        hl = Highlight.objects.create(
            user=user,
            book=book,
            start_position="a",
            end_position="b",
            text="To be deleted",
        )
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/{hl.pk}/delete/",
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert not Highlight.objects.filter(pk=hl.pk).exists()

    def test_auth_required(self, client, user, book):
        hl = Highlight.objects.create(
            user=user,
            book=book,
            start_position="a",
            end_position="b",
            text="auth test",
        )
        response = client.post(f"/books/api/book/{book.slug}/highlight/{hl.pk}/delete/")
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, user, book):
        hl = Highlight.objects.create(
            user=user,
            book=book,
            start_position="a",
            end_position="b",
            text="method test",
        )
        response = authenticated_client.get(
            f"/books/api/book/{book.slug}/highlight/{hl.pk}/delete/"
        )
        assert response.status_code == 405

    def test_nonexistent_pk(self, authenticated_client, book):
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/99999/delete/"
        )
        assert response.status_code == 404

    def test_other_users_highlight(self, authenticated_client, another_user, book):
        hl = Highlight.objects.create(
            user=another_user,
            book=book,
            start_position="a",
            end_position="b",
            text="not yours",
        )
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/highlight/{hl.pk}/delete/"
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/book/<slug>/snippet/ — create
# ---------------------------------------------------------------------------

class TestSnippetCreate:
    def test_happy_path(self, authenticated_client, book):
        payload = {
            "title": "My Snippet",
            "text": "A saved excerpt from the book",
            "note": "Remember this",
            "page_number": 12,
            "position": "epubcfi(/4/2)",
        }
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/snippet/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data == {"ok": True, "id": 1}
        snippet = Snippet.objects.get(pk=1)
        assert snippet.title == "My Snippet"
        assert snippet.text == "A saved excerpt from the book"
        assert snippet.note == "Remember this"
        assert snippet.page_number == 12
        assert snippet.position == "epubcfi(/4/2)"

    def test_minimal_payload(self, authenticated_client, book):
        payload = {"text": "Just the text"}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/snippet/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 200
        snippet = Snippet.objects.get(pk=response.json()["id"])
        assert snippet.title == ""
        assert snippet.note == ""
        assert snippet.page_number == 1
        assert snippet.position == ""

    def test_auth_required(self, client, book):
        payload = {"text": "snippet text"}
        response = client.post(
            f"/books/api/book/{book.slug}/snippet/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code in (302, 403)

    def test_wrong_method_get(self, authenticated_client, book):
        response = authenticated_client.get(f"/books/api/book/{book.slug}/snippet/")
        assert response.status_code == 405

    def test_missing_text(self, authenticated_client, book):
        payload = {"title": "No text"}
        response = authenticated_client.post(
            f"/books/api/book/{book.slug}/snippet/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert response.status_code == 400
