import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000/api/v1";

async function fetchConversations() {
  const response = await fetch(`${API_URL}/conversations`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend returned HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.conversations;
}

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatTitle, setChatTitle] = useState("New chat");
  const [conversationId, setConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [clearAllSuccess, setClearAllSuccess] = useState("");
  const [clearAllError, setClearAllError] = useState("");
  const [isClearAllDialogOpen, setIsClearAllDialogOpen] = useState(false);
  const [isClearingAllChats, setIsClearingAllChats] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const items = await fetchConversations();
        if (!cancelled) {
          setConversations(items);
          setHistoryError("");
          setClearAllSuccess("");
        }
      } catch (error) {
        console.error("Could not load chat history:", error);
        if (!cancelled) {
          setHistoryError("Chat history could not be loaded.");
        }
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    }

    loadConversations();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshConversations() {
    try {
      const items = await fetchConversations();
      setConversations(items);
      setHistoryError("");
    } catch (error) {
      console.error("Could not refresh chat history:", error);
      setHistoryError("Chat history could not be refreshed.");
    }
  }

  function handleNewChat() {
    setMessages([]);
    setMessage("");
    setChatTitle("New chat");
    setConversationId(null);
    setClearAllSuccess("");
  }

  async function handleSelectConversation(id) {
    if (isLoading || isHistoryLoading) return;

    setIsHistoryLoading(true);
    setHistoryError("");
    setClearAllSuccess("");

    try {
      const response = await fetch(`${API_URL}/conversations/${id}`);

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const conversation = await response.json();
      setMessages(conversation.messages);
      setConversationId(conversation.conversation_id);
      setChatTitle(
        conversations.find((item) => item.conversation_id === id)?.title ??
          "Chat"
      );
      setMessage("");
    } catch (error) {
      console.error("Could not load conversation:", error);
      setHistoryError("This conversation could not be opened.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function handleDeleteConversation(id) {
    try {
      const response = await fetch(`${API_URL}/conversations/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      setConversations((previous) =>
        previous.filter((item) => item.conversation_id !== id)
      );

      if (conversationId === id) {
        setMessages([]);
        setMessage("");
        setChatTitle("New chat");
        setConversationId(null);
      }

      setHistoryError("");
    } catch (error) {
      console.error("Could not delete conversation:", error);
      setHistoryError("This conversation could not be deleted.");
    }
  }

  async function handleClearAllChats() {
    setIsClearingAllChats(true);
    setClearAllError("");

    try {
      const response = await fetch(`${API_URL}/conversations`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      setConversations([]);
      setMessages([]);
      setMessage("");
      setChatTitle("New chat");
      setConversationId(null);
      setHistoryError("");
      setClearAllSuccess("All chats cleared.");
      setIsClearAllDialogOpen(false);
    } catch (error) {
      console.error("Could not clear chats:", error);
      setClearAllError("Chats could not be cleared. Please try again.");
    } finally {
      setIsClearingAllChats(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const text = message.trim();
    if (!text || isLoading) return;

    setMessage("");
    setIsLoading(true);
    setChatTitle(text.slice(0, 28));
    setClearAllSuccess("");

    setMessages((previous) => [
      ...previous,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = null;

      function updateAssistantMessage(token) {
        setMessages((previous) => {
          const updated = [...previous];
          const lastIndex = updated.length - 1;

          updated[lastIndex] = {
            ...updated[lastIndex],
            content: updated[lastIndex].content + token,
          };

          return updated;
        });
      }

      function processEvent(block) {
        let eventName = "message";
        const dataLines = [];

        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) return;

        const data = JSON.parse(dataLines.join("\n"));

        if (eventName === "conversation_id") {
          setConversationId(data.conversation_id);
        } else if (eventName === "token") {
          updateAssistantMessage(data.text);
        } else if (eventName === "error") {
          streamError = new Error(
            data.detail || "The AI service encountered an error."
          );
        }
      }

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          if (block.trim()) processEvent(block);
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        processEvent(buffer);
      }

      if (streamError) {
        throw streamError;
      }

      await refreshConversations();
    } catch (error) {
      console.error("Chat request failed:", error);

      setMessages((previous) => {
        const updated = [...previous];
        const lastIndex = updated.length - 1;

        if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
          updated[lastIndex] = {
            ...updated[lastIndex],
            content:
              updated[lastIndex].content ||
              "Sorry, I couldn't get a response. Check that the backend and Ollama are running, then try again.",
          };
        }

        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }


  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">N</div>
          <span>NexGoAI</span>
        </div>

        <button
          className="new-chat"
          onClick={handleNewChat}
          disabled={isLoading}
        >
          <span>＋</span> New chat
        </button>

        <button
          className="clear-all-chats"
          onClick={() => {
            setClearAllError("");
            setIsClearAllDialogOpen(true);
          }}
          disabled={isLoading || isHistoryLoading || isClearingAllChats}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m19 6-1 14H6L5 6" />
            <path d="M10 11v5" />
            <path d="M14 11v5" />
          </svg>
          <span>Clear All Chats</span>
        </button>

        <p className="sidebar-label">YOUR WORKSPACE</p>

        <div className="conversation-list">
          {isHistoryLoading && conversations.length === 0 ? (
            <p className="empty-history">Loading chats…</p>
          ) : conversations.length > 0 ? (
            conversations.map((conversation) => (
              <div
                className={`history-item${
                  conversation.conversation_id === conversationId
                    ? " active"
                    : ""
                }`}
                key={conversation.conversation_id}
              >
                <button
                  className="history-select"
                  onClick={() =>
                    handleSelectConversation(conversation.conversation_id)
                  }
                  disabled={isLoading || isHistoryLoading}
                  title={conversation.title}
                >
                  <span>◷</span>
                  <span>{conversation.title}</span>
                </button>

                <button
                  className="delete-chat"
                  onClick={() =>
                    handleDeleteConversation(conversation.conversation_id)
                  }
                  disabled={isLoading}
                  title="Delete conversation"
                  aria-label={`Delete ${conversation.title}`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="m19 6-1 14H6L5 6" />
                    <path d="M10 11v5" />
                    <path d="M14 11v5" />
                  </svg>
                </button>

              </div>
            ))
          ) : (
            <p className="empty-history">No saved chats yet.</p>
          )}
          {historyError && (
            <p className="empty-history" role="alert">
              {historyError}
            </p>
          )}
          {clearAllSuccess && (
            <p className="clear-all-success" role="status">
              {clearAllSuccess}
            </p>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="avatar">G</div>
          <div>
            <strong>My Workspace</strong>
            <small>Local AI Assistant</small>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <strong>AI Assistant</strong>
            <span className="status-dot" />
            <small>Local model</small>
          </div>
          <span className="model-name">Llama 3.2 · 3B</span>
        </header>

        <section className="chat-area">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">✳</div>
              <h1>What can I help you with?</h1>
              <p>
                Ask a question, explore an idea, or learn something new.
              </p>

              <div className="suggestions">
                {[
                  "Explain Python async programming",
                  "What is Retrieval-Augmented Generation?",
                  "Help me design a FastAPI project",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setMessage(suggestion)}
                  >
                    <span>✧</span>
                    {suggestion}
                    <span className="suggestion-arrow">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((item, index) => (
                <div className="message-row" key={index}>
                  <div className="message-avatar">
                    {item.role === "user" ? "G" : "✳"}
                  </div>
                  <div className="message-content">
                    <strong>
                      {item.role === "user" ? "You" : "NexGoAI"}
                    </strong>
                    <p>{item.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="composer-wrapper">
          <form
            className="composer"
            onSubmit={handleSubmit}
          >
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form.requestSubmit();
                }
              }}
              placeholder="Message NexGoAI..."
              rows={1}
            />

            <div className="composer-bottom">
              <span>↵ Enter to send · Shift + Enter for a new line</span>
              <button
                  type="submit"
                  className="send-button"
                  disabled={!message.trim() || isLoading}
                  aria-label="Send message"
                >
                  {isLoading ? "…" : "↑"}
                </button>
            </div>
          </form>

          <p className="disclaimer">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </main>

      {isClearAllDialogOpen && (
        <div className="clear-all-backdrop">
          <section
            className="clear-all-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-all-title"
            aria-describedby="clear-all-description"
            aria-busy={isClearingAllChats}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isClearingAllChats) {
                setIsClearAllDialogOpen(false);
              }
            }}
          >
            <h2 id="clear-all-title">Clear all chats?</h2>
            <p id="clear-all-description">
              This will permanently delete all conversations and their
              associated data. This action cannot be undone.
            </p>
            {clearAllError && (
              <p className="clear-all-error" role="alert">
                {clearAllError}
              </p>
            )}
            <div className="clear-all-actions">
              <button
                type="button"
                className="clear-all-cancel"
                onClick={() => setIsClearAllDialogOpen(false)}
                disabled={isClearingAllChats}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="clear-all-confirm"
                onClick={handleClearAllChats}
                disabled={isClearingAllChats}
              >
                {isClearingAllChats ? "Clearing…" : "Clear All"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
