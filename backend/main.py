import asyncio
import json
import logging
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_session import AsyncSessionLocal, get_db
from backend.models import Conversation, Message
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
) -> None:
    async with AsyncSessionLocal() as db:
        conversation = await db.get(Conversation, conversation_id)

        if conversation is None:
            conversation = Conversation(
                id=conversation_id,
                title=user_message[:40] or "New chat",
            )
            db.add(conversation)

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


@app.post("/api/v1/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    conversation_id = request.conversation_id or str(uuid4())

    try:
        history = (await load_history(db, conversation_id))[
            -MAX_HISTORY_MESSAGES:
        ]

        answer = await asyncio.to_thread(
            generate_response,
            message=request.message,
            history=history,
        )

        await save_exchange(
            conversation_id,
            request.message,
            answer,
        )

        return ChatResponse(
            conversation_id=conversation_id,
            message=answer,
            model=MODEL_NAME,
        )

    except Exception:
        logger.exception("Chat request failed")
        raise HTTPException(
            status_code=503,
            detail="The AI service or database is temporarily unavailable.",
        )


@app.get("/api/v1/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).order_by(Conversation.created_at.desc())
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
):
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    return {
        "conversation_id": conversation_id,
        "messages": await load_history(db, conversation_id),
    }


@app.delete("/api/v1/conversations")
async def clear_conversations(
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(select(Conversation))
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
):
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
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
):
    conversation_id = request.conversation_id or str(uuid4())

    try:
        history = (await load_history(db, conversation_id))[
            -MAX_HISTORY_MESSAGES:
        ]
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
            iterator = iter(stream_response(request.message, history))

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
