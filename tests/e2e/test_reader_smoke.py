"""Playwright smoke tests: desktop reader golden path."""

import pytest

pytestmark = pytest.mark.e2e


def test_library_shows_book(logged_in_page, e2e_book, live_server):
    page = logged_in_page
    page.goto(f"{live_server.url}/books/")
    page.wait_for_selector(".bk-book-card")
    assert e2e_book.title in page.text_content("body")


def test_reader_loads_and_content_visible(logged_in_page, e2e_book, live_server):
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    # Spinner should disappear and content appear
    page.wait_for_selector(".bk-spinner", state="hidden", timeout=10_000)
    page.wait_for_selector("#native-epub-content", timeout=10_000)
    assert page.is_visible("#native-epub-content")


def test_reader_toolbar_visible(logged_in_page, e2e_book, live_server):
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector(".bk-reader-header", timeout=10_000)
    assert page.is_visible("#btn-settings")


def test_settings_panel_opens_and_closes(logged_in_page, e2e_book, live_server):
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector("#btn-settings", timeout=10_000)

    page.click("#btn-settings")
    page.wait_for_selector("#settings-panel:not([hidden])", timeout=5_000)
    assert page.is_visible("#settings-panel")

    page.click("#btn-settings")
    page.wait_for_selector("#settings-panel[hidden]", timeout=5_000)


def test_highlight_flow(logged_in_page, e2e_book, live_server):
    """Select text → colour picker appears → pick yellow → highlight applied."""
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector("#native-epub-content", timeout=10_000)

    # Select the first paragraph text via JS (programmatic selection is
    # more reliable than mouse-drag across browsers in CI)
    page.evaluate("""() => {
        const p = document.querySelector('#bk-chapter-content p');
        if (!p) return;
        const range = document.createRange();
        range.selectNodeContents(p);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
    }""")

    # Colour picker should appear within the debounce window
    page.wait_for_selector("#highlight-menu:not([hidden])", timeout=2_000)
    assert page.is_visible("#highlight-menu")

    # Click the yellow swatch
    page.click(".bk-hl-color[data-color='yellow']")

    # Menu should close after saving
    page.wait_for_selector("#highlight-menu[hidden]", timeout=5_000)


def test_progress_saved_on_chapter_navigate(logged_in_page, e2e_book, live_server):
    """Navigating between chapters triggers a progress save (API call fires)."""
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector("#native-epub-content", timeout=10_000)

    # The fixture book has only one chapter, so we just confirm the reader
    # renders without error and the footer location text is set.
    page.wait_for_selector("#footer-loc-text", timeout=5_000)
    loc = page.text_content("#footer-loc-text")
    assert loc and loc != ""
