from typing import Optional

from pydantic import BaseModel, Field, validator


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: Optional[str] = None
    document_ids: list[str] = Field(default_factory=list, max_items=20)

    @validator("message")
    def validate_message(cls, value):
        value = value.strip()

        if not value:
            raise ValueError("Message cannot be empty or whitespace.")

        return value


class ChatResponse(BaseModel):
    conversation_id: str
    message: str
    model: str