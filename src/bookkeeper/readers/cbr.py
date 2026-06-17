import io

try:
    import rarfile
except ImportError:
    rarfile = None

from .base import BaseReader, ReaderError

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


class CbrReader(BaseReader):
    def __init__(self, file_obj):
        super().__init__(file_obj)
        if rarfile is None:
            raise ReaderError("rarfile is not installed.")
        try:
            data = file_obj.read()
            file_obj.seek(0)
            self._rf = rarfile.RarFile(io.BytesIO(data))
            self._pages = sorted(
                name for name in self._rf.namelist()
                if any(name.lower().endswith(ext) for ext in IMAGE_EXTS)
            )
        except rarfile.BadRarFile as e:
            raise ReaderError(f"Failed to open CBR: {e}") from e
        except rarfile.RarCannotExec as e:
            raise ReaderError(
                "CBR support requires 'unrar' or 'unar' to be installed on the system. "
                f"Details: {e}"
            ) from e
        except Exception as e:
            raise ReaderError(f"Failed to open CBR: {e}") from e

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
        data = self._rf.read(name)
        ext = name.rsplit(".", 1)[-1].lower()
        content_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
        return data, content_type

    def get_page_count(self) -> int:
        return len(self._pages)
