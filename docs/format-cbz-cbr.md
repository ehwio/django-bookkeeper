# CBZ / CBR Format Support (Comic Books)

## Overview

CBZ (Comic Book ZIP) and CBR (Comic Book RAR) are archives of image files — typically one image per page. Bookkeeper extracts the images server-side at upload time and serves them as ordered pages. Each page is displayed as a single image scaled to fit the reader viewport.

CBZ and CBR are functionally identical from the reader's perspective; the only difference is the archive format (ZIP vs RAR).

## Features

| Feature | Supported |
|---|---|
| Page navigation | Yes |
| Zoom (pinch, double-tap) | Yes |
| Bookmarks | Yes (page-level) |
| Snippets | No |
| Highlights | No |
| Table of contents | No |
| Font / theme settings | No |

## Navigation

- **Prev / Next buttons** advance one page at a time.
- **Swipe left / right** navigates pages on touch devices.
- **Tap left / right zones** (outer 25% of the screen) navigate pages on touch devices when the toolbar is visible.
- **Tap centre** toggles the toolbar visibility.
- Reading progress is saved as the current page number and restored on next open.

## Zoom

| Control | Action |
|---|---|
| Pinch gesture | Continuous zoom |
| Double-tap | Toggle between fit-to-screen and 2× |

Unlike PDF zoom, comic zoom is not persisted between sessions — it resets to fit-to-screen on each page turn, which matches the typical comic reading expectation.

## Bookmarks

Bookmarks capture the current page number. Clicking a bookmark in the sidebar navigates to that page.

## File requirements

- File extensions: `.cbz` (ZIP-based), `.cbr` (RAR-based)
- Maximum upload size: 500 MB (configurable via `MAX_UPLOAD_SIZE`)
- Images inside the archive must be in JPEG, PNG, GIF, or WebP format
- Pages are sorted by filename; archives should use zero-padded filenames (e.g. `001.jpg`, `002.jpg`) to ensure correct order

## Known limitations

- Highlights and snippets are not supported (image-only content).
- Table of contents is not supported.
- RAR5 archives (CBR) require the `unrar` system binary to be available in the deployment environment. CBZ files have no external dependencies.
- Double-spread / two-page layouts are displayed as separate pages, not combined.
