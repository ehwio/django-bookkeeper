from abc import ABC, abstractmethod


class ReaderError(Exception):
    pass


class BaseReader(ABC):
    """
    Abstract base for format-specific book processors.
    Responsible for metadata extraction, cover extraction, and page counting.
    """

    def __init__(self, file_obj):
        self.file_obj = file_obj

    @abstractmethod
    def extract_metadata(self) -> dict:
        """Return dict with keys: title, author, description, publisher,
        published_date, isbn, language, page_count."""

    @abstractmethod
    def extract_cover(self):
        """Return (image_bytes, content_type) or (None, None)."""

    @abstractmethod
    def get_page_count(self) -> int:
        """Return total number of pages/sections."""
