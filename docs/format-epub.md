# EPUB Format Support

## Overview

Bookkeeper uses a native text-extraction pipeline for EPUB files. At upload time the EPUB spine is unpacked into per-chapter HTML stored in the database, so the reader renders directly from Django-served content rather than running epub.js in the browser. This gives fast load times, full text selection, and reliable highlight persistence across sessions.

epub.js is used as a fallback for EPUBs that cannot be unpacked into chapters (e.g. fixed-layout or DRM-encumbered files).

## Features

| Feature | Native (reflowable) | epub.js fallback |
|---|---|---|
| Highlights | Yes | Yes |
| Bookmarks | Yes | Yes |
| Snippets | Yes | Yes |
| Table of contents | Yes | Yes |
| Font / theme settings | Yes | Partial |
| Precise navigation (CFI) | Position offset | CFI string |
| Touch swipe / tap zones | Yes | Yes |

## Navigation

- **Prev / Next buttons** advance one chapter at a time.
- **Swipe left / right** navigates chapters on touch devices.
- **Table of contents** sidebar tab lists all spine items; tap any entry to jump directly.
- Reading progress is saved as `chapterIndex:charOffset` and restored on next open.

## Highlights

Text selection opens the highlight toolbar (floating menu on desktop, bottom sheet on touch). Highlights are stored as character offsets within the chapter and re-applied on every chapter load using the CSS Custom Highlight API (`::highlight()`).

Five colours are available: yellow, green, blue, pink, orange.

## Reader settings

Font family, font size, line height, theme (light / sepia / dark), and column width are saved globally per user and apply to all EPUB books.

## File requirements

- File extension: `.epub`
- Maximum upload size: 500 MB (configurable via `MAX_UPLOAD_SIZE`)
- DRM-free EPUBs only; DRM-locked files will fail chapter extraction and fall back to epub.js, where rendering may be incomplete

## Known limitations

- Fixed-layout EPUBs (e.g. children's picture books, some manga) are not fully supported in native mode and fall back to epub.js.
- Right-to-left (RTL) text support depends on the EPUB's own CSS.
