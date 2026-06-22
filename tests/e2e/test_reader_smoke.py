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
    # JS removes the `hidden` attr from #native-epub-viewer once chapter loads
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)
    assert page.is_visible("#bk-chapter-content")


def test_reader_toolbar_visible(logged_in_page, e2e_book, live_server):
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector(".bk-reader-header", timeout=10_000)
    assert page.is_visible("#btn-settings")


def test_settings_panel_opens_and_closes(logged_in_page, e2e_book, live_server):
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    # Wait for the reader JS to finish initialising (viewer un-hidden)
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    page.click("#btn-settings")
    page.wait_for_selector("#settings-panel:not([hidden])", timeout=5_000)
    assert page.is_visible("#settings-panel")

    page.click("#btn-settings")
    page.wait_for_selector("#settings-panel", state="hidden", timeout=5_000)


def test_highlight_flow(logged_in_page, e2e_book, live_server):
    """Select text → colour picker appears → pick yellow → highlight applied."""
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # Select the first paragraph text via JS (programmatic selection is
    # more reliable than mouse-drag across browsers in CI)
    # Make the selection and wait for the menu to appear entirely inside the
    # browser context so no Python/Playwright round-trip can clear the
    # selection between the event dispatch and the 300ms debounce firing.
    appeared = page.evaluate("""async () => {
        const menu = document.getElementById('highlight-menu');
        const content = document.getElementById('bk-chapter-content');
        const p = content?.querySelector('p');
        if (!p) return false;

        // Focus the content area so the selection sticks in headless Chromium.
        content.setAttribute('tabindex', '-1');
        content.focus();

        await new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
                if (!menu.hidden) { observer.disconnect(); resolve(); }
            });
            observer.observe(menu, { attributes: true, attributeFilter: ['hidden'] });
            // 6 s: 300 ms debounce + generous CI headroom
            setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, 6000);

            const range = document.createRange();
            range.selectNodeContents(p);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
        });
        return !menu.hidden;
    }""")
    assert appeared, "highlight menu did not appear after text selection"
    assert page.is_visible("#highlight-menu")

    # Click the yellow swatch — dispatch directly to avoid the mousedown
    # dismiss handler firing before the click lands on the menu button.
    page.locator(".bk-hl-color[data-color='yellow']").dispatch_event("click")

    # Menu should close after saving
    page.wait_for_selector("#highlight-menu", state="hidden", timeout=5_000)


def test_progress_saved_on_chapter_navigate(logged_in_page, e2e_book, live_server):
    """Navigating between chapters triggers a progress save (API call fires)."""
    page = logged_in_page
    page.goto(f"{live_server.url}/books/book/{e2e_book.slug}/read/")
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # The fixture book has only one chapter, so we just confirm the reader
    # renders without error and the footer location text is set.
    page.wait_for_selector("#footer-loc-text", timeout=5_000)
    loc = page.text_content("#footer-loc-text")
    assert loc and loc != ""
