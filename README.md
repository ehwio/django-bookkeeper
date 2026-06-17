# django-bookkeeper

A Django app for storing, cataloguing, and reading e-Books (PDF, EPUB, CBZ).

## Features

- **Upload** PDF, EPUB, and CBZ files (drag-and-drop or browse)
- **Automatic metadata extraction** — title, author, publisher, cover image
- **Deduplication** by SHA-256 hash
- **Modern reader** with:
  - EPUB rendering via [epub.js](https://github.com/futurepress/epub.js/)
  - PDF rendering via [PDF.js](https://mozilla.github.io/pdf.js/)
  - CBZ page-by-page comic reader
  - Keyboard navigation (arrow keys)
- **Reader settings**: light/sepia/dark themes, font family & size, line height, column width
- **Highlights** in five colours with optional notes
- **Bookmarks** with titles and notes
- **Reading progress** — auto-saved position and percentage
- **5-star ratings** per user
- **Favourites** and finished-book tracking
- **Extensible hook signals** for recent-books lists, activity feeds, etc.
- Django best-practices: `django-storages` compatible, `AUTH_USER_MODEL` aware, namespaced URLs

## Try the demo

The fastest way to see Bookkeeper in action — one command downloads five
public-domain classics from Project Gutenberg and starts a local server:

```bash
git clone https://github.com/ehwio/django-bookkeeper
cd django-bookkeeper
uv sync
make demo
```

Then open **http://127.0.0.1:8000/** and sign in as `demo` / `demo`.

**Or with Docker:**

```bash
docker compose up
```

The demo ships with:
- *Pride and Prejudice* — Jane Austen
- *Twenty Thousand Leagues Under the Seas* — Jules Verne
- *The Time Machine* — H.G. Wells
- *Alice's Adventures in Wonderland* — Lewis Carroll
- *Frankenstein* — Mary Wollstonecraft Shelley

> Books are downloaded from [Project Gutenberg](https://www.gutenberg.org/) on first run.
> They are public domain and freely distributable.

---

## Installation

```bash
pip install django-bookkeeper
# or
uv add django-bookkeeper
```

Add to `INSTALLED_APPS`:

```python
INSTALLED_APPS = [
    ...
    "bookkeeper",
]
```

Include URLs:

```python
# urls.py
from django.urls import include, path

urlpatterns = [
    path("books/", include("bookkeeper.urls", namespace="bookkeeper")),
]
```

Run migrations:

```bash
python manage.py migrate
```

## Optional dependencies

| Feature | Package / Requirement |
|---------|---------|
| Social login | `django-social-auth-app-django` |
| Cloud storage | `django-storages` |
| CBR comic support | system `unrar` or `unar` binary (`rarfile` is included automatically) |

## Hooks

Connect to Bookkeeper signals to extend behaviour:

```python
from bookkeeper.hooks import book_opened, book_finished, progress_updated

@book_opened.connect
def track_recent(sender, user, book, **kwargs):
    RecentBook.objects.update_or_create(user=user, defaults={"book": book})
```

Available signals: `book_opened`, `progress_updated`, `book_finished`, `book_rated`,
`book_uploaded`, `highlight_created`, `bookmark_created`.

## Development

```bash
git clone https://github.com/ehwio/django-bookkeeper
cd django-bookkeeper
uv sync --extra dev
uv run pytest
uv run ruff check src/ tests/
```

### GitFlow

- `main` — stable releases
- `develop` — integration branch
- `feature/*` — new features
- `fix/*` — bug fixes
- `release/*` — release prep

See [RELEASING.md](RELEASING.md) for the step-by-step release process
(TestPyPI → PyPI via GitHub Actions).

## License

MIT
