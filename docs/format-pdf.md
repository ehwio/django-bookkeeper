# PDF Format Support

## Overview

PDFs are rendered client-side using [PDF.js](https://mozilla.github.io/pdf.js/). Each page is drawn to a `<canvas>` element at the current zoom level. Because PDF text is rendered as canvas pixels rather than DOM text nodes, full text selection and highlights are not available.

## Features

| Feature | Supported |
|---|---|
| Page navigation | Yes |
| Zoom (buttons, pinch, double-tap) | Yes |
| Bookmarks | Yes (page-level) |
| Snippets | No |
| Highlights | No |
| Table of contents | Yes (if PDF has an outline) |
| Font / theme settings | No (canvas rendering) |

## Navigation

- **Prev / Next buttons** and the **page number input** in the toolbar navigate by page.
- **Swipe left / right** navigates pages on touch devices.
- **Table of contents** sidebar tab shows the PDF outline if one is embedded in the file.
- Reading progress is saved as the current page number and restored on next open.

## Zoom

| Control | Action |
|---|---|
| `+` / `−` buttons | Zoom in / out in 25% steps |
| Reset button (↺) | Return to 100% |
| Pinch gesture | Continuous zoom (touch devices) |
| Double-tap | Toggle between 100% and 200% |

Zoom level is saved globally per user and persists across sessions and books.

## Bookmarks

Bookmarks capture the current page number. Clicking a bookmark in the sidebar navigates to that page.

## File requirements

- File extension: `.pdf`
- Maximum upload size: 500 MB (configurable via `MAX_UPLOAD_SIZE`)
- Password-protected PDFs are not supported

## Known limitations

- Text selection and copy are not available (canvas rendering).
- Highlights and snippets are not supported for PDF.
- Very large PDFs (500+ pages) may be slow to navigate on low-end devices due to per-page canvas rendering.
