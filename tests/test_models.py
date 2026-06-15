import hashlib

import pytest
from django.contrib.auth import get_user_model

from bookkeeper.models import Book, BookFormat, Bookmark, Highlight, ReadingProgress, UserBook

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


def test_book_str(book):
    assert "Test Book" in str(book)
    assert "Test Author" in str(book)


def test_book_without_author(db, user):
    b = Book(title="No Author", slug="no-author", format=BookFormat.PDF,
             file="x.pdf", file_hash="xyz", added_by=user)
    assert str(b) == "No Author"


def test_book_absolute_url(book):
    url = book.get_absolute_url()
    assert "test-book" in url


def test_book_reader_url(book):
    url = book.get_reader_url()
    assert "read" in url


def test_book_compute_hash():
    data = b"hello world"
    expected = hashlib.sha256(data).hexdigest()

    class FakeFile:
        def chunks(self):
            yield data

    assert Book.compute_hash(FakeFile()) == expected


def test_user_book_creation(db, user, book):
    ub = UserBook.objects.create(user=user, book=book)
    assert ub.rating is None
    assert not ub.is_favorite
    assert not ub.is_finished


def test_reading_progress(db, user, book):
    rp = ReadingProgress.objects.create(
        user=user, book=book, position="epubcfi(/4/2)", page_number=5, percentage=4.5
    )
    assert "4.5" in str(rp)


def test_bookmark(db, user, book):
    bm = Bookmark.objects.create(user=user, book=book, title="Ch 3", position="cfi", page_number=30)
    assert "Ch 3" in str(bm)


def test_highlight(db, user, book):
    hl = Highlight.objects.create(
        user=user, book=book,
        start_position="a", end_position="b",
        text="important passage", color="yellow", page_number=10
    )
    assert "important passage" in str(hl)


def test_userbook_unique_together(db, user, book):
    UserBook.objects.create(user=user, book=book)
    from django.db import IntegrityError
    with pytest.raises(IntegrityError):
        UserBook.objects.create(user=user, book=book)
