import asyncio
import json
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import require_user
from backend.db_session import AsyncSessionLocal, get_db
from backend.embeddings import EMBEDDING_MODEL, embed_documents
from backend.models import Conversation, Document, DocumentChunk, Message
from backend.pdf_processing import (
    MAX_PDF_SIZE_BYTES,
    PDFProcessingError,
    PDFTooLargeError,
    extract_pdf_chunks,
    validate_pdf_upload,
)
from backend.retrieval import (
    format_context,
    format_source_citations,
    retrieve_relevant_chunks,
)
from backend.schemas import ChatRequest, ChatResponse
from backend.services import MODEL_NAME, generate_response, stream_response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GenAI Knowledge Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_HISTORY_MESSAGES = 10


async def load_document_context(
    db: AsyncSession,
    request: ChatRequest,
    user_id: str,
) -> tuple[str, str]:
    if request.document_ids:
        owned = await db.execute(select(Document.id).where(
            Document.id.in_(request.document_ids), Document.owner_id == user_id
        ))
        if set(owned.scalars().all()) != set(request.document_ids):
            raise HTTPException(status_code=404, detail="Document not found.")
    try:
        chunks = await retrieve_relevant_chunks(
            db,
            request.message,
            request.document_ids,
        )
    except Exception as exc:
        logger.exception("Document retrieval or embedding generation failed.")
        raise HTTPException(
            status_code=503,
            detail=(
                "Document search is unavailable. Check that the local "
                f"{EMBEDDING_MODEL} embedding model can be loaded."
            ),
        ) from exc

    return format_context(chunks), format_source_citations(chunks)


async def load_history(
    db: AsyncSession,
    conversation_id: str,
) -> list[dict]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at, Message.id)
    )
    return [
        {"role": item.role, "content": item.content}
        for item in result.scalars().all()
    ]


async def save_exchange(
    conversation_id: str,
    user_message: str,
    assistant_message: str,
    user_id: str,
) -> None:
    async with AsyncSessionLocal() as db:
        conversation = await db.get(Conversation, conversation_id)

        if conversation is None:
            conversation = Conversation(
                id=conversation_id,
                owner_id=user_id,
                title=user_message[:40] or "New chat",
            )
            db.add(conversation)

        if conversation.owner_id != user_id:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        db.add_all([
            Message(
                conversation_id=conversation_id,
                role="user",
                content=user_message,
            ),
            Message(
                conversation_id=conversation_id,
                role="assistant",
                content=assistant_message,
            ),
        ])

        await db.commit()


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/v1/documents")
async def list_documents(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    result = await db.execute(
        select(
            Document.id,
            Document.filename,
            Document.created_at,
            func.count(DocumentChunk.id).label("chunk_count"),
        )
        .outerjoin(DocumentChunk, DocumentChunk.document_id == Document.id)
        .where(Document.owner_id == user_id)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    )
    return {
        "documents": [
            {
                "id": row.id,
                "filename": row.filename,
                "created_at": row.created_at,
                "chunk_count": row.chunk_count,
            }
            for row in result.all()
        ]
    }


@app.post("/api/v1/documents", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    try:
        content = await file.read(MAX_PDF_SIZE_BYTES + 1)
        filename = validate_pdf_upload(
            file.filename or "",
            file.content_type,
            content,
        )
        chunks = extract_pdf_chunks(content)
    except PDFProcessingError as exc:
        status_code = 413 if isinstance(exc, PDFTooLargeError) else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    finally:
        await file.close()

    try:
        vectors = await asyncio.to_thread(
            embed_documents,
            [chunk.content for chunk in chunks],
        )
        if len(vectors) != len(chunks):
            raise ValueError("The embedding service returned an incomplete batch.")
    except Exception as exc:
        logger.exception("PDF embedding generation failed.")
        raise HTTPException(
            status_code=503,
            detail=(
                "PDF indexing is unavailable. Check that the local "
                f"{EMBEDDING_MODEL} embedding model can be loaded. On first "
                "use, the model may need to be downloaded."
            ),
        ) from exc

    document = Document(id=str(uuid4()), filename=filename, owner_id=user_id)
    document.chunks = [
        DocumentChunk(
            page_number=chunk.page_number,
            content=chunk.content,
            embedding=vector,
        )
        for chunk, vector in zip(chunks, vectors)
    ]
    db.add(document)

    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("PDF document storage failed.")
        raise HTTPException(
            status_code=503,
            detail="The document could not be saved to the vector database.",
        ) from exc

    return {
        "id": document.id,
        "filename": document.filename,
        "chunk_count": len(chunks),
    }


@app.delete("/api/v1/documents/{document_id}")
async def delete_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    document = await db.get(Document, document_id)
    if document is None or document.owner_id != user_id:
        raise HTTPException(status_code=404, detail="Document not found.")

    try:
        await db.delete(document)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error("PDF document deletion failed.")
        raise HTTPException(
            status_code=503,
            detail="The document could not be deleted.",
        ) from exc

    return {"message": "Document deleted successfully."}


@app.post("/api/v1/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    if request.conversation_id:
        existing = await db.get(Conversation, request.conversation_id)
        if existing is None or existing.owner_id != user_id:
            raise HTTPException(status_code=404, detail="Conversation not found.")
    conversation_id = request.conversation_id or str(uuid4())

    try:
        history = (await load_history(db, conversation_id))[
            -MAX_HISTORY_MESSAGES:
        ]
        context, citations = await load_document_context(db, request, user_id)

        answer = await asyncio.to_thread(
            generate_response,
            message=request.message,
            history=history,
            context=context,
            citations=citations,
        )

        await save_exchange(
            conversation_id,
            request.message,
            answer,
            user_id,
        )

        return ChatResponse(
            conversation_id=conversation_id,
            message=answer,
            model=MODEL_NAME,
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Chat request failed")
        raise HTTPException(
            status_code=503,
            detail="The AI service or database is temporarily unavailable.",
        )


@app.get("/api/v1/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    result = await db.execute(
        select(Conversation).where(Conversation.owner_id == user_id).order_by(Conversation.created_at.desc())
    )
    conversations = result.scalars().all()

    output = []
    for conversation in conversations:
        history = await load_history(db, conversation.id)
        output.append({
            "conversation_id": conversation.id,
            "title": conversation.title,
            "messages": history,
        })

    return {"conversations": output}


@app.get("/api/v1/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.owner_id != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    return {
        "conversation_id": conversation_id,
        "messages": await load_history(db, conversation_id),
    }


@app.delete("/api/v1/conversations")
async def clear_conversations(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    try:
        result = await db.execute(select(Conversation).where(Conversation.owner_id == user_id))
        conversations = result.scalars().all()

        for conversation in conversations:
            await db.delete(conversation)

        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to clear conversations")
        raise HTTPException(
            status_code=503,
            detail="Unable to clear conversations.",
        )

    return {
        "message": "All conversations cleared successfully.",
        "deleted_count": len(conversations),
    }


@app.delete("/api/v1/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.owner_id != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    await db.delete(conversation)
    await db.commit()
    return {"message": "Conversation deleted successfully."}


def next_chunk(iterator):
    try:
        return True, next(iterator)
    except StopIteration:
        return False, ""


@app.post("/api/v1/chat/stream")
async def chat_stream(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user),
):
    if request.conversation_id:
        existing = await db.get(Conversation, request.conversation_id)
        if existing is None or existing.owner_id != user_id:
            raise HTTPException(status_code=404, detail="Conversation not found.")
    conversation_id = request.conversation_id or str(uuid4())

    try:
        history = (await load_history(db, conversation_id))[
            -MAX_HISTORY_MESSAGES:
        ]
        context, citations = await load_document_context(db, request, user_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to load conversation history")
        raise HTTPException(
            status_code=503,
            detail="Unable to load conversation history.",
        )

    async def event_stream():
        full_answer = ""

        yield "event: conversation_id\n"
        yield "data: " + json.dumps({
            "conversation_id": conversation_id,
        }) + "\n\n"

        try:
            iterator = iter(
                stream_response(
                    request.message,
                    history,
                    context=context,
                    citations=citations,
                )
            )

            while True:
                has_chunk, chunk = await asyncio.to_thread(
                    next_chunk, iterator
                )
                if not has_chunk:
                    break

                full_answer += chunk
                yield "event: token\n"
                yield "data: " + json.dumps({"text": chunk}) + "\n\n"

            await save_exchange(
                conversation_id,
                request.message,
                full_answer,
                user_id,
            )

            yield "event: done\n"
            yield "data: " + json.dumps({
                "conversation_id": conversation_id,
                "model": MODEL_NAME,
            }) + "\n\n"

        except Exception:
            logger.exception("Streaming or database save failed")
            yield "event: error\n"
            yield "data: " + json.dumps({
                "detail": "The AI service or database failed during streaming.",
            }) + "\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
