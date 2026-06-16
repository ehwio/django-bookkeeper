"""Tests for the api_rate view and the templates that render the star rating widget.

Regression test for issue #4: the star rating widget was hardcoding
``/books/api/book/${slug}/rate/`` in JS, which 404s when the app is mounted
at a different prefix. The fix is to inject the URL via a ``data-url-rate``
attribute and read it from ``widget.dataset.urlRate``.
"""

import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse

from bookkeeper.models import Book, BookFormat, UserBook

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="rater", password="pass")


@pytest.fixture
def book(db, user):
    return Book.objects.create(
        title="Rateable Book",
        slug="rateable",
        author="Author",
        format=BookFormat.EPUB,
        file="bookkeeper/books/rateable.epub",
        file_hash="hash-rateable",
        page_count=10,
        added_by=user,
    )


@pytest.fixture
def auth_client(user):
    client = Client()
    client.login(username="rater", password="pass")
    return client


def test_api_rate_url_resolves(book):
    """The namespaced URL resolves to a valid path that includes the slug."""
    url = reverse("bookkeeper:api_rate", kwargs={"slug": book.slug})
    assert url.endswith(f"/api/book/{book.slug}/rate/")
    # Should be namespaced, not hardcoded to /books/
    assert "/books/api/" in url


def test_api_rate_accepts_valid_rating(auth_client, book):
    url = reverse("bookkeeper:api_rate", kwargs={"slug": book.slug})
    response = auth_client.post(
        url,
        data=json.dumps({"rating": 4}),
        content_type="application/json",
    )
    assert response.status_code == 200
    assert json.loads(response.content) == {"ok": True, "rating": 4}


def test_api_rate_rejects_out_of_range(auth_client, book):
    url = reverse("bookkeeper:api_rate", kwargs={"slug": book.slug})
    response = auth_client.post(
        url,
        data=json.dumps({"rating": 7}),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_api_rate_requires_auth(book):
    url = reverse("bookkeeper:api_rate", kwargs={"slug": book.slug})
    response = Client().post(
        url,
        data=json.dumps({"rating": 3}),
        content_type="application/json",
    )
    assert response.status_code in (302, 403)  # redirect to login or forbidden


def test_book_detail_template_exposes_data_url_rate(auth_client, book, user):
    """Regression: book_detail.html must inject the rate URL via data-url-rate
    so the JS widget does not need to hardcode the path."""
    UserBook.objects.create(user=user, book=book, rating=0)
    url = reverse("bookkeeper:book_detail", kwargs={"slug": book.slug})
    response = auth_client.get(url)
    assert response.status_code == 200
    content = response.content.decode()
    assert "bk-star-rating" in content
    assert "data-url-rate=" in content


def test_library_template_exposes_data_url_rate(auth_client, book, user):
    """Regression: library.html must inject the rate URL via data-url-rate."""
    UserBook.objects.create(user=user, book=book, rating=0)
    url = reverse("bookkeeper:library")
    response = auth_client.get(url)
    assert response.status_code == 200
    content = response.content.decode()
    assert "bk-star-rating" in content
    assert "data-url-rate=" in content
