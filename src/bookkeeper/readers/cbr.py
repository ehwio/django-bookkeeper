import io
import zipfile

try:
    import rarfile
except ImportError:
    rarfile = None

from .base import BaseReader, ReaderError

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


class CbrReader(BaseReader):
    def __init__(self, file_obj):
        super().__init__(file_obj)
        try:
            data = file_obj.read()
            file_obj.seek(0)
            buf = io.BytesIO(data)
            self._archive, self._is_zip = self._open(buf)
            self._pages = sorted(
                name for name in self._archive.namelist()
                if any(name.lower().endswith(ext) for ext in IMAGE_EXTS)
            )
        except ReaderError:
            raise
        except Exception as e:
            raise ReaderError(f"Failed to open CBR: {e}") from e

    @staticmethod
    def _open(buf):
        """Try RAR first; fall back to ZIP for mislabeled CBR files."""
        if rarfile is not None:
            try:
                rf = rarfile.RarFile(buf)
                return rf, False
            except rarfile.RarCannotExec as e:
                raise ReaderError(
                    "CBR support requires 'unrar' or 'unar' to be installed on the system. "
                    f"Details: {e}"
                ) from e
            except rarfile.BadRarFile:
                buf.seek(0)

        # File is not a valid RAR (or rarfile unavailable) — try ZIP
        try:
            return zipfile.ZipFile(buf), True
        except zipfile.BadZipFile as e:
            raise ReaderError(f"File is neither a valid RAR nor a ZIP archive: {e}") from e

    def _read(self, name):
        return self._archive.read(name)

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
        data = self._read(name)
        ext = name.rsplit(".", 1)[-1].lower()
        content_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
        return data, content_type

    def get_page_count(self) -> int:
        return len(self._pages)
