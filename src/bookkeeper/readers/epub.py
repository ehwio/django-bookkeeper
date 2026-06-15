import io

import ebooklib
from ebooklib import epub

from .base import BaseReader, ReaderError


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
        # Try epub cover metadata first
        cover_id = None
        for _name, value in self._book.get_metadata("OPF", "cover"):
            cover_id = value.get("content")
            break

        if cover_id:
            item = self._book.get_item_with_id(cover_id)
            if item:
                return item.get_content(), item.media_type

        # Fall back to first image item
        for item in self._book.get_items_of_type(ebooklib.ITEM_IMAGE):
            return item.get_content(), item.media_type

        return None, None

    def get_page_count(self) -> int:
        return len([
            item for item in self._book.get_items()
            if item.get_type() == ebooklib.ITEM_DOCUMENT
        ])
