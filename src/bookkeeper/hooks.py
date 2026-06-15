"""
Hookpoints for django-bookkeeper.

Third-party apps can connect to these hooks to extend behavior.

Usage:
    from bookkeeper.hooks import book_opened, book_finished

    @book_opened.connect
    def on_book_opened(sender, user, book, **kwargs):
        # Track "recently opened" in your own model
        ...
"""
from django.dispatch import Signal

# Fired when a user opens a book in the reader
book_opened = Signal()  # provides: user, book

# Fired when a user saves reading progress
progress_updated = Signal()  # provides: user, book, progress

# Fired when a user marks a book as finished
book_finished = Signal()  # provides: user, book, user_book

# Fired when a user rates a book
book_rated = Signal()  # provides: user, book, rating, previous_rating

# Fired after a book is successfully uploaded and processed
book_uploaded = Signal()  # provides: user, book

# Fired when a highlight is created
highlight_created = Signal()  # provides: user, book, highlight

# Fired when a bookmark is created
bookmark_created = Signal()  # provides: user, book, bookmark
