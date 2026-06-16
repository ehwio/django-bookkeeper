# Agent instructions for django-bookkeeper

This file documents how to work in this repo so AI coding agents follow the
same process humans do. Read this before making changes.

## What this project is

A reusable Django app (`src/bookkeeper/`) for storing, cataloguing, and
reading e-books (PDF, EPUB, CBZ), installable via pip/uv. `demo/` is a
throwaway Django project that exercises the app end-to-end — it is not
part of the published package.

## Branching (GitFlow) — never push directly to main

- `main` — stable releases only. Never commit or push directly here.
- `develop` — integration branch. Feature/fix branches merge here via PR.
- `feature/*` — new features, branched from `develop`.
- `fix/*` — bug fixes, branched from `develop`.
- `release/*` — release prep branches.

Always create a branch and open a PR. Do not push to `develop` or `main`
directly unless explicitly told to.

## Before every push

Run lint and tests. Both must pass:

```bash
uv run ruff check src/ tests/ demo/
uv run pytest --cov
```

CI runs the same `ruff check` command and a pytest matrix across Python
3.11–3.13 and Django 4.2/5.0/5.1 — catch failures locally first.

Note: `ruff format` is not currently enforced (the existing codebase
hasn't been run through the formatter). Don't add a `ruff format --check`
CI gate without first reformatting the codebase as a deliberate, separate
change — otherwise it fails on ~11 pre-existing files immediately.

## Working with the demo project

The demo lives in `demo/` but imports `bookkeeper` from `../src`. Because of
this, commands run from inside `demo/` need an explicit `PYTHONPATH`:

```bash
cd demo
PYTHONPATH=../src:.. uv run python manage.py migrate
PYTHONPATH=../src:.. uv run python manage.py seed_demo
PYTHONPATH=../src:.. uv run python manage.py runserver
```

(`make demo` from the repo root wraps this correctly — prefer it when you
just want to run the demo, use the explicit `PYTHONPATH` form when you need
a one-off management command.)

### Re-seeding after model or extraction changes

`seed_demo --fast` skips books that already exist (matched by file hash),
so changing extraction logic (e.g. `EpubReader.extract_chapters()`) has
**no effect on already-seeded books** — they were extracted once at
upload time and the result is stored in the DB. To pick up extraction
changes:

```bash
PYTHONPATH=../src:.. uv run python manage.py flush --no-input
PYTHONPATH=../src:.. uv run python manage.py seed_demo
```

This applies to any manually-uploaded book too — re-upload it after
pulling a fix to extraction code.

## Architecture notes

- `src/bookkeeper/readers/` — one module per format (`epub.py`, `pdf.py`,
  `cbz.py`), each implementing `BaseReader` (metadata/cover extraction).
  `EpubReader` additionally extracts chapter HTML at upload time (see
  below) — this is EPUB-specific, not part of the shared interface.
- **EPUB chapters are extracted once, at upload time**, not re-parsed on
  every read. `EpubReader.extract_chapters()` walks the spine, sanitizes
  each XHTML item with BeautifulSoup, and stores the result in `Chapter`
  rows. The reader serves `Chapter.html` directly — no epub.js, no
  runtime EPUB parsing. epub.js remains only as a fallback for
  fixed-layout (pre-paginated) EPUBs, which aren't extracted.
- `src/bookkeeper/hooks.py` — Django signals (`book_opened`,
  `progress_updated`, `book_finished`, `book_rated`, `book_uploaded`,
  `highlight_created`, `bookmark_created`) are the extension points for
  consuming projects. Don't add new functionality that should be
  observable externally without firing a signal.
- URLs are namespaced (`bookkeeper:`) and never hardcode a mount prefix
  in templates — always use `{% url %}`. The demo mounts the app at `/`,
  but consuming projects can mount it anywhere (e.g. `/books/`).
  **JavaScript must follow the same rule**: never hardcode an API path
  like `/books/api/...` — read it from a `data-url-*` attribute injected
  via `{% url %}` in the template. (See `reader.html`/`reader.js` for the
  pattern. A hardcoded path in `bookkeeper.js`'s star-rating widget is a
  known bug — see issue #4.)

## Known gotchas worth knowing before touching the reader

- **EPUB self-closing tags**: BeautifulSoup's `lxml-xml` parser (needed to
  read well-formed XHTML) serializes empty elements as `<tag/>`, which is
  valid XML but meaningless to a browser's HTML5 parser for non-void
  elements like `<a>` — the tag stays open and swallows everything after
  it. `EpubReader.extract_chapters()` works around this by forcing an
  explicit empty text node on empty non-void, non-SVG elements before
  serializing. Don't "simplify" this by reparsing the whole fragment
  through an HTML parser — that lowercases SVG's case-sensitive
  attributes (e.g. `viewBox` → `viewbox`), breaking SVG cover rendering.
- **Flexbox scroll containers need `min-height: 0`**: flex children
  default to `min-height: auto`, meaning they won't shrink below their
  content size. Any new scrollable panel inside the reader's flex layout
  needs `min-height: 0` alongside `overflow-y: auto`, or it will grow to
  fit all content instead of scrolling.
- **`[hidden]` can be overridden by author CSS**: if you give an element
  with the `hidden` attribute its own `display: flex`/`block` rule, that
  rule wins over the browser's `[hidden] { display: none }` UA rule. Any
  element toggled via the `hidden` attribute needs an explicit
  `#id[hidden] { display: none; }` rule alongside its own display rules
  (see the four reader viewer divs in `reader.css` for the pattern).

## Release process

Versioning is currently manual (static `version` in `pyproject.toml`,
not git-tag-derived).

1. Bump `version` in `pyproject.toml`.
2. Commit, merge to `main` via the normal release-branch flow.
3. Tag and push `vX.Y.Z` — this triggers `publish-testpypi.yml`, which
   verifies the tag matches the `pyproject.toml` version and publishes to
   **test.pypi.org** via OIDC trusted publishing.
4. Verify the TestPyPI release installs and works correctly.
5. Cut a GitHub Release from that tag — this triggers `publish-pypi.yml`,
   which publishes to **pypi.org**.

Both publish workflows gate on the CI workflow (lint + test matrix)
passing first, via `workflow_call`. Trusted publisher config (on both
PyPI and TestPyPI) must reference the exact workflow filename and
environment name — see `.github/workflows/publish-*.yml` for the
environment names (`testpypi` / `pypi`).
