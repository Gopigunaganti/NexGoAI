from functools import lru_cache

from fastembed import TextEmbedding
from numpy import ndarray


EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
EMBEDDING_DIMENSIONS = 768
EMBEDDING_BATCH_SIZE = 32


@lru_cache(maxsize=1)
def _get_embedding_model() -> TextEmbedding:
    return TextEmbedding(model_name=EMBEDDING_MODEL)


def _validated_vector(vector: ndarray) -> list[float]:
    values = vector.tolist()
    if len(values) != EMBEDDING_DIMENSIONS:
        raise ValueError(
            f"{EMBEDDING_MODEL} must return "
            f"{EMBEDDING_DIMENSIONS}-dimension vectors."
        )
    return values


def embed_documents(texts: list[str]) -> list[list[float]]:
    model = _get_embedding_model()
    vectors = []

    for offset in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[offset:offset + EMBEDDING_BATCH_SIZE]
        batch_vectors = list(model.passage_embed(batch))
        if len(batch_vectors) != len(batch):
            raise ValueError("The embedding model returned an incomplete batch.")
        vectors.extend(_validated_vector(vector) for vector in batch_vectors)

    return vectors


def embed_query(text: str) -> list[float]:
    model = _get_embedding_model()
    vectors = list(model.query_embed(text))
    if len(vectors) != 1:
        raise ValueError("The embedding model did not return one query vector.")
    return _validated_vector(vectors[0])
