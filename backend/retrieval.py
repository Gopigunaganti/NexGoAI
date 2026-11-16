import asyncio
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from backend.embeddings import embed_query
from backend.models import DocumentChunk


MAX_RETRIEVED_CHUNKS = 5


async def retrieve_relevant_chunks(
    db: AsyncSession,
    query: str,
    document_ids: Sequence[str],
) -> list[DocumentChunk]:
    if not document_ids:
        return []

    query_vector = await asyncio.to_thread(embed_query, query)
    result = await db.execute(
        select(DocumentChunk)
        .options(joinedload(DocumentChunk.document))
        .where(DocumentChunk.document_id.in_(document_ids))
        .order_by(DocumentChunk.embedding.cosine_distance(query_vector))
        .limit(MAX_RETRIEVED_CHUNKS)
    )
    return list(result.scalars().all())


def format_context(chunks: Sequence[DocumentChunk]) -> str:
    if not chunks:
        return ""
    return "\n\n".join(
        f"[{chunk.document.filename}, p. {chunk.page_number}]\n{chunk.content}"
        for chunk in chunks
    )


def format_source_citations(chunks: Sequence[DocumentChunk]) -> str:
    sources = []
    seen = set()
    for chunk in chunks:
        source = (chunk.document.filename, chunk.page_number)
        if source not in seen:
            seen.add(source)
            sources.append(source)

    if not sources:
        return ""
    citations = "; ".join(
        f"{filename} (p. {page_number})"
        for filename, page_number in sources
    )
    return f"\n\nSources: {citations}"
