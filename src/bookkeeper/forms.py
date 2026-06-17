from django import forms

from .models import Book, Bookmark, Highlight


class BookUploadForm(forms.Form):
    file = forms.FileField(
        label="Book file",
        help_text="Supported formats: PDF, EPUB, CBZ, CBR",
    )
    title = forms.CharField(max_length=500, required=False, label="Title (optional)")
    author = forms.CharField(max_length=500, required=False, label="Author (optional)")

    def clean_file(self):
        f = self.cleaned_data["file"]
        name = f.name.lower()
        if not any(name.endswith(ext) for ext in (".pdf", ".epub", ".cbz", ".cbr")):
            raise forms.ValidationError("Only PDF, EPUB, CBZ, and CBR files are accepted.")
        max_mb = 500
        if f.size > max_mb * 1024 * 1024:
            raise forms.ValidationError(f"File too large. Maximum size is {max_mb} MB.")
        return f


class HighlightForm(forms.ModelForm):
    class Meta:
        model = Highlight
        fields = ["color", "note"]


class BookmarkForm(forms.ModelForm):
    class Meta:
        model = Bookmark
        fields = ["title", "note"]


class BookMetadataForm(forms.ModelForm):
    """Allows editing book metadata fields that users can reasonably change."""

    class Meta:
        model = Book
        fields = [
            "title",
            "author",
            "description",
            "publisher",
            "published_date",
            "isbn",
            "language",
        ]
