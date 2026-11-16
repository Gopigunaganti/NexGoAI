from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
import re
from typing import Optional

from pypdf import PdfReader


MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 500
MAX_DOCUMENT_CHUNKS = 5000
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150


class PDFProcessingError(ValueError):
    pass


class PDFTooLargeError(PDFProcessingError):
    pass


@dataclass(frozen=True)
class PDFChunk:
    page_number: int
    content: str


def validate_pdf_upload(
    filename: str,
    content_type: Optional[str],
    content: bytes,
) -> str:
    safe_filename = PurePosixPath(filename.replace("\\", "/")).name
    safe_filename = re.sub(r"[\x00-\x1f\x7f]", " ", safe_filename).strip()

    if not safe_filename.lower().endswith(".pdf"):
        raise PDFProcessingError("Choose a PDF file.")
    if len(safe_filename) > 255:
        safe_filename = f"{safe_filename[:251]}.pdf"
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type not in ("", "application/pdf", "application/octet-stream"):
        raise PDFProcessingError("The uploaded file must have PDF content.")
    if not content:
        raise PDFProcessingError("The selected PDF is empty.")
    if len(content) > MAX_PDF_SIZE_BYTES:
        raise PDFTooLargeError("PDF files must be 10 MB or smaller.")
    if b"%PDF-" not in content[:1024]:
        raise PDFProcessingError("The uploaded file is not a valid PDF.")

    return safe_filename


def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("Chunk overlap must be non-negative and smaller than chunk size.")

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            boundary = max(
                text.rfind(" ", start + chunk_size // 2, end),
                text.rfind("\n", start + chunk_size // 2, end),
            )
            if boundary > start:
                end = boundary

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end == len(text):
            break
        start = max(start + 1, end - overlap)
        while start < len(text) and text[start].isspace():
            start += 1

    return chunks


def extract_pdf_chunks(content: bytes) -> list[PDFChunk]:
    try:
        reader = PdfReader(BytesIO(content), strict=False)
        if reader.is_encrypted:
            raise PDFProcessingError("Password-protected PDFs are not supported.")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise PDFProcessingError(
                f"PDFs must contain {MAX_PDF_PAGES} pages or fewer."
            )

        chunks = []
        for page_number, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            normalized_text = " ".join(page_text.split())
            chunks.extend(
                PDFChunk(page_number=page_number, content=chunk)
                for chunk in chunk_text(normalized_text)
            )

        if not chunks:
            raise PDFProcessingError(
                "No selectable text was found. Scanned PDFs require OCR before upload."
            )
        if len(chunks) > MAX_DOCUMENT_CHUNKS:
            raise PDFProcessingError("This PDF contains too much text to index.")
        return chunks
    except PDFProcessingError:
        raise
    except Exception as exc:
        raise PDFProcessingError("The PDF could not be read.") from exc
