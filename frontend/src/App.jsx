import { useEffect, useRef, useState } from "react";
import "./App.css";
import AgentMode from "./AgentMode.jsx";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Menu,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

const API_URL = "/api/v1";

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

async function fetchDocuments() {
  const response = await fetch(`${API_URL}/documents`);

  if (!response.ok) {
    throw new Error(`Backend returned HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.documents;
}

async function responseError(response, fallback) {
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
  } catch {
    // Use the fallback for responses without a readable API error.
  }
  return fallback;
}

function ChatApp() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(null);
  const [chatError, setChatError] = useState("");
  const composerRef = useRef(null);
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);
  const dialogRef = useRef(null);
  const clearButtonRef = useRef(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatTitle, setChatTitle] = useState("New chat");
  const [conversationId, setConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(true);
  const [isDocumentUploading, setIsDocumentUploading] = useState(false);
  const [documentError, setDocumentError] = useState("");
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

  useEffect(() => {
    let cancelled = false;

    async function loadDocuments() {
      try {
        const items = await fetchDocuments();
        if (!cancelled) {
          setDocuments(items);
          setDocumentError("");
        }
      } catch (error) {
        console.error("Could not load PDFs:", error);
        if (!cancelled) {
          setDocumentError("PDF documents could not be loaded.");
        }
      } finally {
        if (!cancelled) {
          setIsDocumentsLoading(false);
        }
      }
    }

    loadDocuments();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isClearAllDialogOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [isClearAllDialogOpen]);

  async function copyMessage(content, index) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(index);
    } catch {
      setChatError("Copy is unavailable. Select the response text to copy it.");
    }
  }

  function choosePrompt(prompt) {
    setMessage(prompt);
    composerRef.current?.focus();
  }

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
    setSidebarOpen(false);
    if (composerRef.current) composerRef.current.style.height = "auto";
    setChatError("");
    setCopied(null);
    composerRef.current?.focus();
    setMessages([]);
    setMessage("");
    setChatTitle("New chat");
    setConversationId(null);
    setSelectedDocumentIds([]);
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
      setSidebarOpen(false);
      setChatError("");
      setCopied(null);
      stickToBottom.current = true;
      setMessages(conversation.messages);
      setConversationId(conversation.conversation_id);
      setSelectedDocumentIds([]);
      setChatTitle(
        conversations.find((item) => item.conversation_id === id)?.title ??
          "Chat",
      );
      setMessage("");
    } catch (error) {
      console.error("Could not load conversation:", error);
      setHistoryError("This conversation could not be opened.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function handleUploadDocument(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setDocumentError("Choose a PDF file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setDocumentError("PDF files must be 10 MB or smaller.");
      return;
    }

    setIsDocumentUploading(true);
    setDocumentError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_URL}/documents`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        throw new Error(
          await responseError(response, "The PDF could not be indexed."),
        );
      }

      const document = await response.json();
      setDocuments((previous) => [
        document,
        ...previous.filter((item) => item.id !== document.id),
      ]);
      if (selectedDocumentIds.length < 20) {
        setSelectedDocumentIds((previous) =>
          previous.includes(document.id)
            ? previous
            : [...previous, document.id],
        );
      } else {
        setDocumentError(
          "PDF indexed, but not selected: choose no more than 20 PDFs per chat.",
        );
      }
    } catch (error) {
      setDocumentError(error.message || "The PDF could not be indexed.");
    } finally {
      setIsDocumentUploading(false);
    }
  }

  function handleDocumentSelection(id) {
    if (!selectedDocumentIds.includes(id) && selectedDocumentIds.length >= 20) {
      setDocumentError("Choose no more than 20 PDFs per chat.");
      return;
    }

    setSelectedDocumentIds((previous) =>
      previous.includes(id)
        ? previous.filter((selectedId) => selectedId !== id)
        : [...previous, id],
    );
    setDocumentError("");
  }

  async function handleDeleteDocument(id) {
    setDocumentError("");
    try {
      const response = await fetch(`${API_URL}/documents/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "The PDF could not be deleted."),
        );
      }
      setDocuments((previous) => previous.filter((item) => item.id !== id));
      setSelectedDocumentIds((previous) =>
        previous.filter((selectedId) => selectedId !== id),
      );
    } catch (error) {
      setDocumentError(error.message || "The PDF could not be deleted.");
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
        previous.filter((item) => item.conversation_id !== id),
      );

      if (conversationId === id) {
        setMessages([]);
        setMessage("");
        setChatTitle("New chat");
        setConversationId(null);
        setSelectedDocumentIds([]);
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
      setSelectedDocumentIds([]);
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
    setChatError("");
    setCopied(null);
    stickToBottom.current = true;
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
          document_ids: selectedDocumentIds,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await responseError(
            response,
            `Backend returned HTTP ${response.status}`,
          ),
        );
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
            data.detail || "The AI service encountered an error.",
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
      setChatError(
        error.message ||
          "The response could not be completed. Please try again.",
      );

      setMessages((previous) => {
        const updated = [...previous];
        const lastIndex = updated.length - 1;

        if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
          updated[lastIndex] = {
            ...updated[lastIndex],
            content:
              updated[lastIndex].content ||
              error.message ||
              "Sorry, I couldn't get a response. Check that the backend is running and your Groq API key is configured, then try again.",
          };
        }

        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }

  const visibleConversations = conversations.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()),
  );
  const prompts = [
    {
      icon: BookOpen,
      title: "Understand something",
      description: "Make complex ideas feel simple",
      prompt: "Explain Python async programming with a practical example.",
    },
    {
      icon: FileText,
      title: "Explore a document",
      description: "Find the details that matter",
      prompt: "Summarize the key takeaways from my selected documents.",
    },
    {
      icon: Sparkles,
      title: "Build on an idea",
      description: "Turn a thought into a plan",
      prompt:
        "Help me design a FastAPI project. Ask me about my requirements first.",
    },
  ];

  return (
    <div className="workspace">
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            if (!isLoading) handleNewChat();
          }}
        >
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          NexGo<span>AI</span>
        </a>
        <a href="/agent" className="new-chat" style={{textDecoration:"none",justifyContent:"center",marginBottom:10}}><Sparkles size={18}/> Agent Mode <span>↗</span></a>
        <button
          className="new-chat"
          onClick={handleNewChat}
          disabled={isLoading}
        >
          <Plus size={18} /> New conversation <span>↗</span>
        </button>
        <label className="history-search">
          <Search size={16} />
          <input
            aria-label="Search conversations"
            placeholder="Search your chats"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="section-label">
          CONVERSATIONS <span>{conversations.length}</span>
        </div>
        <nav className="conversation-list" aria-label="Conversations">
          {isHistoryLoading && (
            <p className="muted" role="status">
              Loading conversations…
            </p>
          )}
          {!isHistoryLoading && visibleConversations.length === 0 && (
            <div className="history-empty">
              <MessageSquare size={22} />
              <p>{search ? "No matching conversations" : "A fresh start"}</p>
              <small>
                {search
                  ? "Try another search."
                  : "Your conversations will appear here."}
              </small>
            </div>
          )}
          {visibleConversations.map((item) => (
            <div
              className={`history-item ${conversationId === item.conversation_id ? "active" : ""}`}
              key={item.conversation_id}
            >
              <button
                className="history-select"
                disabled={isLoading || isHistoryLoading}
                onClick={() => handleSelectConversation(item.conversation_id)}
                aria-current={
                  conversationId === item.conversation_id ? "page" : undefined
                }
              >
                <MessageSquare size={15} />
                <span>{item.title}</span>
              </button>
              <button
                className="icon-button delete-chat"
                aria-label={`Delete ${item.title}`}
                disabled={isLoading}
                onClick={() => handleDeleteConversation(item.conversation_id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {historyError && (
            <p className="error" role="alert">
              {historyError}
            </p>
          )}
          {clearAllSuccess && (
            <p className="success" role="status">
              {clearAllSuccess}
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-action"
            onClick={() => {
              setDocumentsOpen(true);
              setSidebarOpen(false);
            }}
          >
            <BookOpen size={17} /> Document library{" "}
            <span>{documents.length}</span>
          </button>
          <button
            ref={clearButtonRef}
            className="nav-action"
            disabled={isLoading || isHistoryLoading || !conversations.length}
            onClick={() => {
              setClearAllError("");
              setIsClearAllDialogOpen(true);
            }}
          >
            <Trash2 size={16} /> Clear conversations
          </button>
          <div className="workspace-profile">
            <span className="profile-icon">N</span>
            <div>
              <strong>Personal workspace</strong>
              <small>Chat & document library</small>
            </div>
          </div>
        </div>
      </aside>

      <main className={`main ${messages.length === 0 ? "is-empty" : ""}`}>
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span>
            </span>
            <strong>{chatTitle}</strong>
          </div>
          <button
            className={`document-button ${documentsOpen ? "selected" : ""}`}
            aria-expanded={documentsOpen}
            onClick={() => setDocumentsOpen(!documentsOpen)}
          >
            <BookOpen size={16} />
            <span>Documents</span>
            <span className="count">{documents.length}</span>
          </button>
        </header>
        <section
          className="chat-scroll"
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickToBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
          aria-label="Chat messages"
        >
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-emblem">
                <Sparkles size={30} strokeWidth={1.4} />
              </div>
              <h1>
                Your next idea starts here.
                <br />
                <span>Let’s make it happen.</span>
              </h1>
              <p>
                A thoughtful space to ask questions, explore documents, and
                create.
              </p>
              <div className="suggestions">
                {prompts.map(({ icon: Icon, title, description, prompt }) => (
                  <button
                    key={title}
                    onClick={() => {
                      choosePrompt(prompt);
                      if (title === "Explore a document")
                        setDocumentsOpen(true);
                    }}
                  >
                    <span className="suggestion-top">
                      <Icon size={21} strokeWidth={1.5} />
                      <ArrowUpRight size={15} />
                    </span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((item, index) => (
                <article className={`message ${item.role}`} key={index}>
                  <div className="message-label">
                    {item.role === "user" ? (
                      <span className="user-mark">Y</span>
                    ) : (
                      <span className="assistant-mark">
                        <Sparkles size={16} />
                      </span>
                    )}
                    <strong>{item.role === "user" ? "You" : "NexGoAI"}</strong>
                  </div>
                  <div className="message-body">
                    {item.content ? (
                      <Markdown remarkPlugins={[remarkGfm]}>
                        {item.content}
                      </Markdown>
                    ) : isLoading ? (
                      <span className="thinking" role="status">
                        Thinking<span>● ● ●</span>
                      </span>
                    ) : null}
                  </div>
                  {item.role === "assistant" &&
                    item.content &&
                    !(isLoading && index === messages.length - 1) && (
                      <button
                        className="copy-button"
                        onClick={() => copyMessage(item.content, index)}
                      >
                        {copied === index ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        {copied === index ? "Copied" : "Copy response"}
                      </button>
                    )}
                </article>
              ))}
            </div>
          )}
        </section>
        <div className="composer-wrapper">
          {chatError && (
            <div className="error-banner" role="alert">
              {chatError}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setChatError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <form className="composer" onSubmit={handleSubmit}>
            {selectedDocumentIds.length > 0 && (
              <div className="attachment-chips">
                {documents
                  .filter((doc) => selectedDocumentIds.includes(doc.id))
                  .map((doc) => (
                    <span key={doc.id}>
                      <FileText size={13} />
                      <span>{doc.filename}</span>
                      <button
                        type="button"
                        aria-label={`Deselect ${doc.filename}`}
                        disabled={isLoading}
                        onClick={() => handleDocumentSelection(doc.id)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              aria-label="Message NexGoAI"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form.requestSubmit();
                }
              }}
              placeholder={
                selectedDocumentIds.length
                  ? "Ask about your selected documents…"
                  : "What’s on your mind?"
              }
              rows={2}
            />
            <div className="composer-toolbar">
              <button
                className="attach-button"
                type="button"
                onClick={() => setDocumentsOpen(!documentsOpen)}
                aria-expanded={documentsOpen}
              >
                <Paperclip size={17} /> Attach PDFs
              </button>
              <button
                type="button"
                className="composer-context"
                onClick={() => setDocumentsOpen(!documentsOpen)}
                aria-expanded={documentsOpen}
              >
                {selectedDocumentIds.length
                  ? `${selectedDocumentIds.length} selected`
                  : "General chat"}
                <ChevronDown size={12} />
              </button>
              <button
                className="send-button"
                disabled={!message.trim() || isLoading || isHistoryLoading}
                aria-label={isLoading ? "Generating response" : "Send message"}
              >
                {isLoading ? (
                  <span className="spinner" />
                ) : (
                  <ArrowUp size={20} />
                )}
              </button>
            </div>
          </form>
          <p className="composer-hint">
            <span>Enter to send · Shift + Enter for a new line</span>
            <span>AI can make mistakes. Check important details.</span>
          </p>
        </div>
      </main>
      {documentsOpen && (
        <aside className="documents-drawer" aria-label="Document library">
          <header>
            <div>
              <span className="section-label">YOUR KNOWLEDGE</span>
              <h2>Documents</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close documents"
              onClick={() => setDocumentsOpen(false)}
            >
              <X size={19} />
            </button>
          </header>
          <p className="drawer-description">
            Add PDFs and select the ones you want to explore in this
            conversation.
          </p>
          <label
            className={`upload-zone ${isDocumentUploading ? "uploading" : ""}`}
          >
            <span className="upload-icon">
              {isDocumentUploading ? (
                <span className="spinner" />
              ) : (
                <Plus size={24} />
              )}
            </span>
            <strong>
              {isDocumentUploading ? "Indexing your document…" : "Add a PDF"}
            </strong>
            <small>Text-based PDFs · Up to 10 MB</small>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleUploadDocument}
              disabled={isDocumentUploading || isLoading}
              aria-label="Upload PDF"
            />
          </label>
          <div className="library-heading">
            <strong>
              Library <span>{documents.length}</span>
            </strong>
            <small>{selectedDocumentIds.length}/20 selected</small>
          </div>
          <div className="document-list">
            {isDocumentsLoading ? (
              <p role="status" className="muted">
                Loading documents…
              </p>
            ) : documents.length === 0 ? (
              <div className="documents-empty">
                <FileText size={28} />
                <strong>Your knowledge starts here</strong>
                <p>
                  Upload a PDF to ask questions and find answers in its pages.
                </p>
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  className={`document-item ${selectedDocumentIds.includes(doc.id) ? "checked" : ""}`}
                  key={doc.id}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedDocumentIds.includes(doc.id)}
                      disabled={
                        isLoading ||
                        (!selectedDocumentIds.includes(doc.id) &&
                          selectedDocumentIds.length >= 20)
                      }
                      onChange={() => handleDocumentSelection(doc.id)}
                    />
                    <FileText size={20} />
                    <span>
                      <strong title={doc.filename}>{doc.filename}</strong>
                      <small>PDF document</small>
                    </span>
                  </label>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${doc.filename}`}
                    disabled={isLoading || isDocumentUploading}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${doc.filename}? This removes the PDF from your library.`,
                        )
                      )
                        handleDeleteDocument(doc.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          {documentError && (
            <p className="error" role="alert">
              {documentError}
            </p>
          )}
          <div className="library-note">
            <BookOpen size={16} />
            <p>
              Selected documents give your conversation context. Deselect all to
              return to general chat.
            </p>
          </div>
        </aside>
      )}
      <dialog
        ref={dialogRef}
        className="confirm-dialog"
        onCancel={(event) => {
          if (isClearingAllChats) event.preventDefault();
          else setIsClearAllDialogOpen(false);
        }}
        onClose={() => {
          setIsClearAllDialogOpen(false);
          clearButtonRef.current?.focus();
        }}
        aria-labelledby="clear-title"
      >
        <div className="danger-icon">
          <Trash2 size={24} />
        </div>
        <h2 id="clear-title">Clear your conversations?</h2>
        <p>All saved chats and messages will be permanently deleted.</p>
        {clearAllError && (
          <p className="error" role="alert">
            {clearAllError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            disabled={isClearingAllChats}
            onClick={() => setIsClearAllDialogOpen(false)}
            autoFocus
          >
            Keep conversations
          </button>
          <button
            className="danger-button"
            disabled={isClearingAllChats}
            onClick={handleClearAllChats}
          >
            {isClearingAllChats ? "Clearing…" : "Clear all"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
export default function App() {
  return window.location.pathname.replace(/\/$/, '') === '/agent' ? <AgentMode /> : <ChatApp />;
}
