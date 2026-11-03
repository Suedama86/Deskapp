import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ChatMessage,
  ChatStatus,
  detectProvider,
  streamChat,
} from "../lib/ai";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusLabel(status: ChatStatus): string {
  switch (status.phase) {
    case "idle":
      return detectProvider() === "stub" ? "Stub · offline" : "Ready";
    case "connecting":
      return `Connecting · ${status.provider}`;
    case "streaming":
      return `Streaming · ${status.provider}`;
    case "done":
      return `Done · ${status.provider}`;
    case "error":
      return "Error";
  }
}

export function AiPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Forge Agent ready. Ask for refactors, explanations, or commit messages. Replies stream in the stub (offline) or via an OpenAI-compatible provider when VITE_LLM_API_KEY is set.",
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ChatStatus>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pending =
    status.phase === "connecting" || status.phase === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus({ phase: "idle" });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = uid();
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      },
    ]);
    setInput("");
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamChat(messages, text, {
        signal: ac.signal,
        onStatus: setStatus,
        onChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            ),
          );
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content
                    ? `${m.content}\n\n[stopped]`
                    : "[stopped]",
                }
              : m,
          ),
        );
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || m.content.length > 0),
        );
      }
    } finally {
      abortRef.current = null;
      setStatus((s) => (s.phase === "error" ? s : { phase: "idle" }));
    }
  };

  return (
    <aside className="panel ai-panel">
      <header className="panel-header">
        <div className="panel-title">Forge Agent</div>
        <div className="ai-header-meta">
          <span className={`badge${detectProvider() === "stub" ? " stub" : ""}`}>
            {detectProvider() === "stub" ? "Stub" : "LLM"}
          </span>
          <span className="ai-status">{statusLabel(status)}</span>
        </div>
      </header>
      <div className="chat-log">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-bubble ${m.role}${
              pending && m.role === "assistant" && m === messages[messages.length - 1]
                ? " streaming"
                : ""
            }`}
          >
            <div className="chat-role">{m.role === "user" ? "You" : "Agent"}</div>
            <pre>
              {m.content || (pending ? "…" : "")}
              {pending &&
              m.role === "assistant" &&
              m === messages[messages.length - 1] ? (
                <span className="caret" aria-hidden>
                  ▍
                </span>
              ) : null}
            </pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error ? <div className="error pad">{error}</div> : null}
      <form className="chat-input" onSubmit={(e) => void onSubmit(e)}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Forge Agent…"
          rows={3}
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="chat-actions">
          {pending ? (
            <button type="button" className="ghost-btn danger" onClick={stop}>
              Stop
            </button>
          ) : null}
          <button
            type="submit"
            className="primary-btn"
            disabled={pending || !input.trim()}
          >
            {pending ? "Streaming…" : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
}
