import io
import zipfile

from .base import BaseReader, ReaderError

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


class CbzReader(BaseReader):
    def __init__(self, file_obj):
        super().__init__(file_obj)
        try:
            data = file_obj.read()
            file_obj.seek(0)
            self._zf = zipfile.ZipFile(io.BytesIO(data))
            self._pages = sorted(
                name for name in self._zf.namelist()
                if any(name.lower().endswith(ext) for ext in IMAGE_EXTS)
            )
        except Exception as e:
            raise ReaderError(f"Failed to open CBZ: {e}") from e

    def extract_metadata(self) -> dict:
        return {
            "title": "",
            "author": "",
            "description": "",
            "publisher": "",
            "published_date": "",
            "isbn": "",
            "language": "",
            "page_count": len(self._pages),
        }

    def extract_cover(self):
        if not self._pages:
            return None, None
        name = self._pages[0]
        data = self._zf.read(name)
        ext = name.rsplit(".", 1)[-1].lower()
        content_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
        return data, content_type

    def get_page_count(self) -> int:
        return len(self._pages)
