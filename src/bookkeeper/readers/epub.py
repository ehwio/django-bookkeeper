import hashlib
import io
import os

import ebooklib
from ebooklib import epub

from .base import BaseReader, ReaderError

# Placeholder written into img src during extraction; replaced with real
# media URLs in the upload view once images are saved to disk.
IMG_PLACEHOLDER_PREFIX = "__BK_IMG__"


class EpubReader(BaseReader):
    def __init__(self, file_obj):
        super().__init__(file_obj)
        try:
            data = file_obj.read()
            file_obj.seek(0)
            self._book = epub.read_epub(io.BytesIO(data))
        except Exception as e:
            raise ReaderError(f"Failed to open EPUB: {e}") from e

    def extract_metadata(self) -> dict:
        b = self._book

        def meta(name):
            items = b.get_metadata("DC", name)
            return items[0][0] if items else ""

        spine_items = [
            item for item in b.get_items() if item.get_type() == ebooklib.ITEM_DOCUMENT
        ]

        return {
            "title": meta("title"),
            "author": meta("creator"),
            "description": meta("description"),
            "publisher": meta("publisher"),
            "published_date": meta("date"),
            "isbn": meta("identifier"),
            "language": meta("language") or "en",
            "page_count": len(spine_items),
        }

    def extract_cover(self):
        cover_id = None
        for _name, value in self._book.get_metadata("OPF", "cover"):
            cover_id = value.get("content")
            break

        if cover_id:
            item = self._book.get_item_with_id(cover_id)
            if item:
                return item.get_content(), item.media_type

        for item in self._book.get_items_of_type(ebooklib.ITEM_IMAGE):
            return item.get_content(), item.media_type

        return None, None

    def get_page_count(self) -> int:
        return len([
            item for item in self._book.get_items()
            if item.get_type() == ebooklib.ITEM_DOCUMENT
        ])

    def is_fixed_layout(self) -> bool:
        """True for pre-paginated EPUBs (manga, fixed-layout children's books)."""
        for _name, value in self._book.get_metadata("OPF", "rendition:layout"):
            if isinstance(value, dict) and value.get("content") == "pre-paginated":
                return True
            if value == "pre-paginated":
                return True
        return False

    def extract_chapters(self) -> list[dict]:
        """
        Walk the EPUB spine and return one dict per spine item:
            title        – text of the first heading found in the item
            html         – sanitized inner HTML of <body>; image srcs are
                           replaced with IMG_PLACEHOLDER_PREFIX + epub_path
                           so the upload view can swap in real media URLs
            char_count   – plain-text length (used for reading progress %)
            content_hash – 16-char SHA-256 prefix (stale-offset guard)
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError as e:
            raise ReaderError("beautifulsoup4 is required for chapter extraction") from e

        chapters = []

        for spine_id, _linear in self._book.spine:
            item = self._book.get_item_with_id(spine_id)
            if item is None or item.get_type() != ebooklib.ITEM_DOCUMENT:
                continue

            raw = item.get_content()
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")

            soup = BeautifulSoup(raw, "lxml-xml")

            # Title: first heading element in the item
            title = ""
            for tag in ("h1", "h2", "h3"):
                el = soup.find(tag)
                if el:
                    title = el.get_text(strip=True)
                    break

            body = soup.find("body") or soup

            # Resolve image src paths relative to this item's position in the ZIP
            item_dir = os.path.dirname(item.get_name())
            for img in body.find_all("img"):
                src = img.get("src", "")
                if src and not src.startswith(("http://", "https://", "data:")):
                    normalized = (
                        os.path.normpath(os.path.join(item_dir, src))
                        .replace("\\", "/")
                        .lstrip("/")
                    )
                    img["src"] = IMG_PLACEHOLDER_PREFIX + normalized

            # Rewrite internal links: keep fragment anchors, neutralize xhtml hrefs
            for a in body.find_all("a", href=True):
                href = a["href"]
                if href.startswith(("http://", "https://", "mailto:")):
                    continue
                if "#" in href:
                    a["href"] = "#" + href.split("#", 1)[1]
                else:
                    a["href"] = "#"

            # Strip any script tags
            for tag in body.find_all("script"):
                tag.decompose()

            html = body.decode_contents()
            char_count = len(body.get_text())
            content_hash = hashlib.sha256(html.encode()).hexdigest()[:16]

            chapters.append({
                "title": title,
                "html": html,
                "char_count": char_count,
                "content_hash": content_hash,
            })

        return chapters

    def extract_images(self) -> dict[str, tuple[bytes, str]]:
        """
        Return {epub_path: (bytes, media_type)} for every image in the EPUB.
        epub_path is the item's normalized name within the ZIP (no leading slash).
        """
        result = {}
        for item in self._book.get_items_of_type(ebooklib.ITEM_IMAGE):
            name = item.get_name().lstrip("/")
            result[name] = (item.get_content(), item.media_type)
        return result
