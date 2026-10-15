from typing import Dict, List, Optional

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage


MODEL_NAME = "llama3.2:3b"

model = ChatOllama(
    model=MODEL_NAME,
    client_kwargs={"timeout": 60},
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