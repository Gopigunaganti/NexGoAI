from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy.dialects import postgresql

from backend.retrieval import (
    DEFAULT_TOP_K,
    MAX_TOP_K,
    MAX_RETRIEVED_CHUNKS,
    _parse_top_k,
    format_context,
    format_source_citations,
    retrieve_relevant_chunks,
)
from backend.schemas import ChatRequest


class RetrievalTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_selected_documents_skips_embedding_and_retrieval(self):
        with patch("backend.retrieval.embed_query") as embed_query:
            chunks = await retrieve_relevant_chunks(
                db=None,
                query="What does this say?",
                document_ids=[],
            )

        self.assertEqual(chunks, [])
        embed_query.assert_not_called()

    async def test_selected_documents_scope_cosine_search(self):
        result = Mock()
        result.scalars.return_value.all.return_value = []
        db = Mock(execute=AsyncMock(return_value=result))

        with patch("backend.retrieval.embed_query", return_value=[0.0] * 768):
            chunks = await retrieve_relevant_chunks(
                db=db,
                query="What does this say?",
                document_ids=["selected-document"],
            )

        self.assertEqual(chunks, [])
        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(dialect=postgresql.dialect()))
        self.assertIn("document_chunks.document_id IN", sql)
        self.assertIn("document_chunks.embedding <=>", sql)

    async def test_configured_top_k_controls_query_limit(self):
        result = Mock()
        result.scalars.return_value.all.return_value = []
        db = Mock(execute=AsyncMock(return_value=result))

        with patch("backend.retrieval.MAX_RETRIEVED_CHUNKS", 8):
            with patch(
                "backend.retrieval.embed_query",
                return_value=[0.0] * 768,
            ):
                await retrieve_relevant_chunks(
                    db=db,
                    query="What does this say?",
                    document_ids=["selected-document"],
                )

        statement = db.execute.await_args.args[0]
        compiled = statement.compile(dialect=postgresql.dialect())
        self.assertIn(8, compiled.params.values())

    def test_top_k_configuration_defaults_and_validates_bounds(self):
        self.assertEqual(_parse_top_k(None), DEFAULT_TOP_K)
        self.assertEqual(_parse_top_k("1"), 1)
        self.assertEqual(_parse_top_k(str(MAX_TOP_K)), MAX_TOP_K)

        for value in ("0", str(MAX_TOP_K + 1), "invalid"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "RAG_TOP_K"):
                    _parse_top_k(value)

    def test_chat_request_defaults_to_plain_chat_and_limits_document_scope(self):
        request = ChatRequest(message="Hello")
        self.assertEqual(request.document_ids, [])

        with self.assertRaises(ValueError):
            ChatRequest(message="Hello", document_ids=["doc"] * 21)

    def test_context_and_citations_include_document_pages_once(self):
        first = SimpleNamespace(
            document=SimpleNamespace(filename="guide.pdf"),
            page_number=2,
            content="Relevant excerpt",
        )
        repeated_source = SimpleNamespace(
            document=SimpleNamespace(filename="guide.pdf"),
            page_number=2,
            content="Another excerpt",
        )

        self.assertIn("[guide.pdf, p. 2]", format_context([first]))
        self.assertEqual(
            format_source_citations([first, repeated_source]),
            "\n\nSources: guide.pdf (p. 2)",
        )


if __name__ == "__main__":
    unittest.main()
