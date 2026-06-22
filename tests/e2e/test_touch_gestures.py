"""Playwright touch-gesture tests using iPhone 14 emulation.

Touch events are dispatched via JavaScript so the reader's touchstart/
touchend handlers receive them with correct coordinates and timestamps.
"""

import pytest

pytestmark = pytest.mark.e2e

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Both touch events are dispatched in a single evaluate call so there is no
# Python round-trip between touchstart and touchend.  Separate evaluate calls
# can exceed the 300 ms TAP_MAX_MS threshold on slow CI machines.
_TAP_JS = """
([x, y]) => {
    const el = document.getElementById('reader-viewport');
    if (!el) return false;
    function fire(type, cx, cy) {
        const touch = new Touch({
            identifier: 1, target: el,
            clientX: cx, clientY: cy,
            pageX: cx, pageY: cy, screenX: cx, screenY: cy,
            radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
        });
        el.dispatchEvent(new TouchEvent(type, {
            bubbles: true, cancelable: true,
            touches:        type === 'touchend' ? [] : [touch],
            changedTouches: [touch],
        }));
    }
    fire('touchstart', x, y);
    fire('touchend',   x, y);
    return true;
}
"""

_SWIPE_JS = """
([x_start, x_end, y]) => {
    const el = document.getElementById('reader-viewport');
    if (!el) return false;
    function fire(type, cx, cy) {
        const touch = new Touch({
            identifier: 1, target: el,
            clientX: cx, clientY: cy,
            pageX: cx, pageY: cy, screenX: cx, screenY: cy,
            radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
        });
        el.dispatchEvent(new TouchEvent(type, {
            bubbles: true, cancelable: true,
            touches:        type === 'touchend' ? [] : [touch],
            changedTouches: [touch],
        }));
    }
    fire('touchstart', x_start, y);
    fire('touchend',   x_end,   y);
    return true;
}
"""


def touch_tap(page, x, y):
    """Dispatch touchstart + touchend at (x, y) in a single evaluate call."""
    page.evaluate(_TAP_JS, [x, y])


def touch_swipe(page, x_start, x_end, y):
    """Dispatch a horizontal swipe in a single evaluate call."""
    page.evaluate(_SWIPE_JS, [x_start, x_end, y])


# #native-chapter-loc is updated by loadChapter() as "N / total" (1-based).
# #footer-loc-text is only updated on button-click; don't use it for initial state.
_LOC_CH2 = "document.querySelector('#native-chapter-loc')?.textContent?.startsWith('2')"
_LOC_CH1 = "document.querySelector('#native-chapter-loc')?.textContent?.startsWith('1')"


def chrome_hidden(page) -> bool:
    return page.evaluate("document.getElementById('bk-reader').classList.contains('chrome-hidden')")


def current_chapter(page) -> int:
    """Return the current spine_index from the native chapter loc (e.g. '2 / 2' → 1)."""
    label = page.text_content("#native-chapter-loc") or ""
    # label format: "N / total" — 1-based
    try:
        return int(label.split("/")[0].strip()) - 1
    except (IndexError, ValueError):
        return -1


def reader_url(live_server, book):
    return f"{live_server.url}/books/book/{book.slug}/read/"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def _force_chrome_visible(page):
    """Force chrome visible and cancel any pending auto-hide timer.

    The reader schedules a 3-second hideChrome() setTimeout on load.  If that
    fires between this call and the subsequent touch_tap, tapCenter() sees
    chrome as hidden and calls showChrome() instead of hideChrome(), inverting
    the expected result.  We cancel recent timer IDs to neutralise it.
    """
    page.evaluate("""() => {
        document.getElementById('bk-reader').classList.remove('chrome-hidden');
        // Probe for the current highest timer ID, then clear a window of
        // recent IDs that would include the auto-hide timer.
        const probe = setTimeout(() => {}, 0);
        clearTimeout(probe);
        for (let i = Math.max(1, probe - 200); i <= probe; i++) clearTimeout(i);
    }""")


def test_chrome_autohides_on_touch_device(mobile_page, e2e_book, live_server):
    """Centre tap hides chrome; verifies tapCenter() → hideChrome() path."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # Cancel any pending auto-hide timer and force chrome visible so the test
    # doesn't race against the 3-second timeout on slow CI machines.
    _force_chrome_visible(page)
    assert not chrome_hidden(page), "chrome should be visible"

    w = page.evaluate("window.innerWidth")
    h = page.evaluate("window.innerHeight")
    touch_tap(page, w // 2, h // 2)
    assert chrome_hidden(page), "centre tap should hide chrome"


def test_centre_tap_toggles_chrome(mobile_page, e2e_book, live_server):
    """Tap centre once to hide, tap again to show."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    _force_chrome_visible(page)
    w = page.evaluate("window.innerWidth")
    h = page.evaluate("window.innerHeight")
    cx, cy = w // 2, h // 2

    touch_tap(page, cx, cy)
    assert chrome_hidden(page), "first centre tap should hide chrome"

    touch_tap(page, cx, cy)
    assert not chrome_hidden(page), "second centre tap should show chrome"


def test_swipe_left_advances_chapter(mobile_page, e2e_book_2ch, live_server):
    """Swipe left (dx < -50) should load the next chapter."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book_2ch))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)
    page.wait_for_function(_LOC_CH1, timeout=5_000)
    assert current_chapter(page) == 0

    w = page.evaluate("window.innerWidth")
    h = page.evaluate("window.innerHeight")
    touch_swipe(page, w * 3 // 4, w // 4, h // 2)  # swipe left >50 px

    page.wait_for_function(_LOC_CH2, timeout=5_000)
    assert current_chapter(page) == 1


def test_swipe_right_goes_to_prev_chapter(mobile_page, e2e_book_2ch, live_server):
    """Swipe right (dx > 50) from chapter 2 should return to chapter 1."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book_2ch))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # Navigate to chapter 2 first via the next button.
    page.click("#native-next")
    page.wait_for_function(_LOC_CH2, timeout=5_000)
    assert current_chapter(page) == 1

    w = page.evaluate("window.innerWidth")
    h = page.evaluate("window.innerHeight")
    touch_swipe(page, w // 4, w * 3 // 4, h // 2)  # swipe right >50 px

    page.wait_for_function(_LOC_CH1, timeout=5_000)
    assert current_chapter(page) == 0


def test_tap_right_zone_advances_chapter(mobile_page, e2e_book_2ch, live_server):
    """Tap in the right 25% of the viewport should advance to next chapter."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book_2ch))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)
    page.wait_for_function(_LOC_CH1, timeout=5_000)
    assert current_chapter(page) == 0

    w = page.evaluate("window.innerWidth")
    h = page.evaluate("window.innerHeight")
    # Tap at 85% width — well into the right zone (>75%)
    touch_tap(page, int(w * 0.85), h // 2)

    page.wait_for_function(_LOC_CH2, timeout=5_000)
    assert current_chapter(page) == 1


def test_tap_left_zone_goes_to_prev_chapter(mobile_page, e2e_book_2ch, live_server):
    """Tap in the left 25% of the viewport should go back a chapter."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book_2ch))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # Move to chapter 2 first.
    page.click("#native-next")
    page.wait_for_function(_LOC_CH2, timeout=5_000)

    w = page.evaluate("window.innerWidth")
    h = page.evaluate("window.innerHeight")
    # Tap at 10% width — well into the left zone (<25%)
    touch_tap(page, int(w * 0.10), h // 2)

    page.wait_for_function(_LOC_CH1, timeout=5_000)
    assert current_chapter(page) == 0


def test_settings_panel_opens_via_tap(mobile_page, e2e_book, live_server):
    """Tapping the settings button on a touch device opens the settings panel."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    page.click("#btn-settings")
    page.wait_for_selector("#settings-panel:not([hidden])", timeout=5_000)
    assert page.is_visible("#settings-panel")


def test_settings_panel_closes_via_backdrop(mobile_page, e2e_book, live_server):
    """Tapping the backdrop behind the settings panel closes it."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    page.click("#btn-settings")
    page.wait_for_selector("#settings-panel:not([hidden])", timeout=5_000)

    # Click the backdrop element directly.
    page.locator("#settings-backdrop").dispatch_event("click")
    page.wait_for_selector("#settings-panel", state="hidden", timeout=5_000)
