from django.urls import path

from . import views

app_name = "bookkeeper"

urlpatterns = [
    path("", views.LibraryView.as_view(), name="library"),
    path("upload/", views.upload_book, name="upload"),
    path("book/<slug:slug>/", views.BookDetailView.as_view(), name="book_detail"),
    path("book/<slug:slug>/read/", views.reader_view, name="reader"),
    # API
    path("api/book/<slug:slug>/progress/", views.api_progress, name="api_progress"),
    path("api/book/<slug:slug>/rate/", views.api_rate, name="api_rate"),
    path("api/book/<slug:slug>/finish/", views.api_finish, name="api_finish"),
    path("api/book/<slug:slug>/favorite/", views.api_favorite, name="api_favorite"),
    path("api/book/<slug:slug>/cover/", views.api_cover, name="api_cover"),
    path("api/book/<slug:slug>/page/<int:index>/", views.api_comic_page, name="api_comic_page"),
    path(
        "api/book/<slug:slug>/highlight/",
        views.api_highlight_create,
        name="api_highlight_create",
    ),
    path(
        "api/book/<slug:slug>/highlight/<int:pk>/delete/",
        views.api_highlight_delete,
        name="api_highlight_delete",
    ),
    path(
        "api/book/<slug:slug>/bookmark/",
        views.api_bookmark_create,
        name="api_bookmark_create",
    ),
    path(
        "api/book/<slug:slug>/bookmark/<int:pk>/delete/",
        views.api_bookmark_delete,
        name="api_bookmark_delete",
    ),
    path("api/reader-settings/", views.api_reader_settings, name="api_reader_settings"),
    path("api/book/<slug:slug>/chapter/<int:index>/", views.api_chapter, name="api_chapter"),
    # Chapter eval — feature/epub-extraction only
    path("book/<slug:slug>/eval/<int:index>/", views.chapter_eval, name="chapter_eval"),
]
