from ..models import BookFormat
from .base import ReaderError


def get_reader(format: str, file_obj):
    """Return an appropriate reader instance for the given format."""
    if format == BookFormat.EPUB:
        from .epub import EpubReader
        return EpubReader(file_obj)
    elif format == BookFormat.PDF:
        from .pdf import PdfReader
        return PdfReader(file_obj)
    elif format == BookFormat.CBZ:
        from .cbz import CbzReader
        return CbzReader(file_obj)
    raise ReaderError(f"Unsupported format: {format}")
