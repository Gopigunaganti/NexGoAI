import unittest
from unittest.mock import patch

from backend.embeddings import (
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_DIMENSIONS,
    embed_documents,
    embed_query,
)


class FakeVector:
    def tolist(self):
        return [0.25] * EMBEDDING_DIMENSIONS


class FakeEmbeddingModel:
    def __init__(self):
        self.document_batch_sizes = []

    def passage_embed(self, texts):
        self.document_batch_sizes.append(len(texts))
        return (FakeVector() for _ in texts)

    def query_embed(self, query):
        return iter([FakeVector()])


class EmbeddingTests(unittest.TestCase):
    def test_document_embeddings_are_batched_and_768_dimensions(self):
        model = FakeEmbeddingModel()
        texts = ["text"] * (EMBEDDING_BATCH_SIZE + 1)

        with patch("backend.embeddings._get_embedding_model", return_value=model):
            vectors = embed_documents(texts)

        self.assertEqual(model.document_batch_sizes, [32, 1])
        self.assertEqual(len(vectors), len(texts))
        self.assertTrue(all(
            len(vector) == EMBEDDING_DIMENSIONS for vector in vectors
        ))

    def test_query_embedding_returns_one_768_dimension_vector(self):
        with patch(
            "backend.embeddings._get_embedding_model",
            return_value=FakeEmbeddingModel(),
        ):
            vector = embed_query("What does the PDF say?")

        self.assertEqual(len(vector), EMBEDDING_DIMENSIONS)


if __name__ == "__main__":
    unittest.main()
