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


_RESET_AND_TAP_JS = """
() => {
    // Cancel ALL pending timers so the auto-hide cannot fire between the
    // reset and the tap (they happen synchronously in the same JS tick).
    const probe = setTimeout(() => {}, 0);
    for (let i = 1; i <= probe; i++) clearTimeout(i);

    const reader = document.getElementById('bk-reader');
    reader.classList.remove('chrome-hidden');

    // Tap the centre of the viewport.
    const el = document.getElementById('reader-viewport');
    if (!el) return {before: null, after: null};
    const x = Math.round(window.innerWidth / 2);
    const y = Math.round(window.innerHeight / 2);
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
    return reader.classList.contains('chrome-hidden');
}
"""


def test_chrome_autohides_on_touch_device(mobile_page, e2e_book, live_server):
    """Centre tap hides chrome; verifies tapCenter() → hideChrome() path."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # Diagnostic: understand the state before/after tap.
    diag = page.evaluate("""() => {
        const reader = document.getElementById('bk-reader');
        const vp = document.getElementById('reader-viewport');
        const zonePrev = document.getElementById('zone-prev');
        const zoneNext = document.getElementById('zone-next');
        const zoneCenter = document.getElementById('zone-center');

        const probe = setTimeout(() => {}, 0);
        for (let i = 1; i <= probe; i++) clearTimeout(i);

        const beforeClass = reader.classList.contains('chrome-hidden');
        reader.classList.remove('chrome-hidden');
        const afterRemove = reader.classList.contains('chrome-hidden');

        let probeListenerFired = false;
        let touchEndDispatched = false;

        if (vp) {
            // Probe listener to confirm dispatchEvent reaches the element
            vp.addEventListener('touchend',
                () => { probeListenerFired = true; }, { once: true, passive: true });

            const w = window.innerWidth;
            const h = window.innerHeight;
            const x = Math.round(w / 2);
            const y = Math.round(h / 2);
            function fire(type, cx, cy) {
                const touch = new Touch({
                    identifier: 1, target: vp,
                    clientX: cx, clientY: cy, pageX: cx, pageY: cy,
                    screenX: cx, screenY: cy,
                    radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
                });
                vp.dispatchEvent(new TouchEvent(type, {
                    bubbles: true, cancelable: true,
                    touches: type === 'touchend' ? [] : [touch],
                    changedTouches: [touch],
                }));
                if (type === 'touchend') touchEndDispatched = true;
            }
            fire('touchstart', x, y);
            fire('touchend', x, y);

            return {
                vpExists: true,
                zonePrevExists: !!zonePrev,
                zoneNextExists: !!zoneNext,
                zoneCenterExists: !!zoneCenter,
                beforeClass,
                afterRemove,
                probeListenerFired,
                touchEndDispatched,
                afterTap: reader.classList.contains('chrome-hidden'),
                coarsePointer: window.matchMedia('(pointer: coarse)').matches,
                innerWidth: w,
                innerHeight: h,
                tapX: x,
                tapY: y,
            };
        }
        return {
            vpExists: false,
            zonePrevExists: !!zonePrev, zoneNextExists: !!zoneNext,
            zoneCenterExists: !!zoneCenter,
        };
    }""")
    touch_debug = page.evaluate("window.__bk_touch_debug || null")
    print("DIAG:", diag)
    print("TOUCH_DEBUG:", touch_debug)
    assert diag["afterTap"], (
        f"centre tap should hide chrome — diag: {diag}, touch_debug: {touch_debug}"
    )


def test_centre_tap_toggles_chrome(mobile_page, e2e_book, live_server):
    """Tap centre once to hide, tap again to show."""
    page = mobile_page
    page.goto(reader_url(live_server, e2e_book))
    page.wait_for_selector("#native-epub-viewer:not([hidden])", timeout=10_000)

    # First tap: reset to visible then tap → should hide.
    hidden_after_first = page.evaluate(_RESET_AND_TAP_JS)
    assert hidden_after_first, "first centre tap should hide chrome"

    # Second tap: chrome is now hidden, tap → should show.
    # No need to reset; just tap centre directly.
    touch_tap(page, page.evaluate("Math.round(window.innerWidth/2)"),
              page.evaluate("Math.round(window.innerHeight/2)"))
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
