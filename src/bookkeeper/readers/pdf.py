import fitz  # PyMuPDF

from .base import BaseReader, ReaderError


class PdfReader(BaseReader):
    def __init__(self, file_obj):
        super().__init__(file_obj)
        try:
            data = file_obj.read()
            file_obj.seek(0)
            self._doc = fitz.open(stream=data, filetype="pdf")
        except Exception as e:
            raise ReaderError(f"Failed to open PDF: {e}") from e

    def extract_metadata(self) -> dict:
        meta = self._doc.metadata or {}
        return {
            "title": meta.get("title", ""),
            "author": meta.get("author", ""),
            "description": meta.get("subject", ""),
            "publisher": meta.get("producer", ""),
            "published_date": meta.get("creationDate", ""),
            "isbn": "",
            "language": "",
            "page_count": self._doc.page_count,
        }

    def extract_cover(self):
        if not self._doc.page_count:
            return None, None
        page = self._doc[0]
        pix = page.get_pixmap(dpi=150)
        return pix.tobytes("png"), "image/png"

    def get_page_count(self) -> int:
        return self._doc.page_count
