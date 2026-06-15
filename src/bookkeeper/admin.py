from django.contrib import admin

from .models import Book, Bookmark, Highlight, ReaderSettings, ReadingProgress, UserBook


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "author", "format", "page_count", "added_by", "created_at")
    list_filter = ("format",)
    search_fields = ("title", "author", "isbn")
    readonly_fields = ("file_hash", "file_size", "page_count", "created_at", "updated_at")
    prepopulated_fields = {"slug": ("title",)}


@admin.register(UserBook)
class UserBookAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "rating", "is_favorite", "is_finished", "date_last_read")
    list_filter = ("rating", "is_favorite", "is_finished")
    search_fields = ("user__username", "book__title")


@admin.register(ReadingProgress)
class ReadingProgressAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "page_number", "percentage", "updated_at")
    search_fields = ("user__username", "book__title")


@admin.register(Bookmark)
class BookmarkAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "title", "page_number", "created_at")
    search_fields = ("user__username", "book__title", "title")


@admin.register(Highlight)
class HighlightAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "color", "page_number", "created_at")
    list_filter = ("color",)
    search_fields = ("user__username", "book__title", "text")


@admin.register(ReaderSettings)
class ReaderSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "font_family", "font_size", "theme")
