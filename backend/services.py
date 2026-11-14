import os
from typing import Dict, List, Optional

from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_groq import ChatGroq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing from your .env file")

MODEL_NAME = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

model = ChatGroq(
    model=MODEL_NAME,
    api_key=GROQ_API_KEY,
    timeout=60,
)

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful AI knowledge assistant."),
    MessagesPlaceholder(variable_name="history"),
    ("human", "{message}"),
])


def generate_response(
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
) -> str:
    history = history or []

    history_messages = []

    for item in history:
        if item["role"] == "user":
            history_messages.append(
                HumanMessage(content=item["content"])
            )
        elif item["role"] == "assistant":
            history_messages.append(
                AIMessage(content=item["content"])
            )

    chain = prompt | model

    response = chain.invoke({
        "history": history_messages,
        "message": message,
    })

    return response.content


def stream_response(
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
):
    history = history or []

    history_messages = []

    for item in history:
        if item["role"] == "user":
            history_messages.append(
                HumanMessage(content=item["content"])
            )
        elif item["role"] == "assistant":
            history_messages.append(
                AIMessage(content=item["content"])
            )

    chain = prompt | model

    for chunk in chain.stream({
        "history": history_messages,
        "message": message,
    }):
        if chunk.content:
            yield chunk.content