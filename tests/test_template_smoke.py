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
def user_book(db, user, book):
    """Associate the book with the user so reader/detail views load cleanly."""
    return UserBook.objects.create(user=user, book=book)


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def authenticated_client(client, user):
    client.force_login(user)
    return client


# ---------------------------------------------------------------------------
# Library view — GET /
# ---------------------------------------------------------------------------

class TestLibraryView:
    def test_renders_200_with_correct_template(self, authenticated_client, user_book):
        response = authenticated_client.get("/books/")
        assert response.status_code == 200
        assert "bookkeeper/library.html" in [t.name for t in response.templates]

    def test_contains_user_books(self, authenticated_client, user_book):
        response = authenticated_client.get("/books/")
        assert response.status_code == 200
        # The context should include the user's books
        assert "user_books" in response.context

    def test_anonymous_redirects_to_login(self, client):
        response = client.get("/books/")
        # AnonymousAccessMixin or @login_required → redirect to login
        assert response.status_code == 302


# ---------------------------------------------------------------------------
# Book detail view — GET /book/<slug>/
# ---------------------------------------------------------------------------

class TestBookDetailView:
    def test_renders_200_with_correct_template(self, authenticated_client, user_book, book):
        response = authenticated_client.get(f"/books/book/{book.slug}/")
        assert response.status_code == 200
        assert "bookkeeper/book_detail.html" in [t.name for t in response.templates]

    def test_context_contains_book(self, authenticated_client, user_book, book):
        response = authenticated_client.get(f"/books/book/{book.slug}/")
        assert response.status_code == 200
        assert response.context["book"] == book

    def test_anonymous_redirects_to_login(self, client, book):
        response = client.get(f"/books/book/{book.slug}/")
        assert response.status_code == 302


# ---------------------------------------------------------------------------
# Reader view — GET /book/<slug>/read/
# ---------------------------------------------------------------------------

class TestReaderView:
    def test_renders_200_with_correct_template(self, authenticated_client, user_book, book):
        response = authenticated_client.get(f"/books/book/{book.slug}/read/")
        assert response.status_code == 200
        assert "bookkeeper/reader.html" in [t.name for t in response.templates]

    def test_context_contains_book(self, authenticated_client, user_book, book):
        response = authenticated_client.get(f"/books/book/{book.slug}/read/")
        assert response.status_code == 200
        assert response.context["book"] == book

    def test_anonymous_redirects_to_login(self, client, book):
        response = client.get(f"/books/book/{book.slug}/read/")
        assert response.status_code == 302
