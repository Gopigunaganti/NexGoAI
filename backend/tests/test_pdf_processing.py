from io import BytesIO
import unittest

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from backend.pdf_processing import (
    MAX_PDF_SIZE_BYTES,
    PDFProcessingError,
    chunk_text,
    extract_pdf_chunks,
    validate_pdf_upload,
)


class PDFProcessingTests(unittest.TestCase):
    def create_text_pdf(self):
        writer = PdfWriter()
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })
        font_reference = writer._add_object(font)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({
                NameObject("/F1"): font_reference,
            }),
        })
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 72 720 Td (Hello RAG) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
        buffer = BytesIO()
        writer.write(buffer)
        return buffer.getvalue()

    def test_upload_validation_checks_name_content_and_size(self):
        self.assertEqual(
            validate_pdf_upload(
                "folder\\report.PDF",
                "application/pdf",
                b"%PDF-1.7 data",
            ),
            "report.PDF",
        )

        invalid_uploads = [
            ("report.txt", "application/pdf", b"%PDF-1.7 data"),
            ("report.pdf", "text/plain", b"%PDF-1.7 data"),
            ("report.pdf", "application/pdf", b"not a PDF"),
            (
                "report.pdf",
                "application/pdf",
                b"%PDF-" + b"x" * MAX_PDF_SIZE_BYTES,
            ),
        ]
        for filename, content_type, content in invalid_uploads:
            with self.subTest(filename=filename, content_type=content_type):
                with self.assertRaises(PDFProcessingError):
                    validate_pdf_upload(filename, content_type, content)

    def test_chunk_text_bounds_chunks_and_preserves_overlap(self):
        text = "word " * 80
        chunks = chunk_text(text, chunk_size=100, overlap=20)

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 100 for chunk in chunks))
        self.assertTrue(any(
            first[-10:] in second
            for first, second in zip(chunks, chunks[1:])
        ))

    def test_scanned_pdf_without_selectable_text_has_clear_error(self):
        buffer = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.write(buffer)

        with self.assertRaisesRegex(PDFProcessingError, "OCR"):
            extract_pdf_chunks(buffer.getvalue())

    def test_extracts_text_with_one_based_source_page(self):
        chunks = extract_pdf_chunks(self.create_text_pdf())

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].page_number, 1)
        self.assertEqual(chunks[0].content, "Hello RAG")


if __name__ == "__main__":
    unittest.main()
