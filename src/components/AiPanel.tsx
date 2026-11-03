import { FormEvent, useEffect, useRef, useState } from "react";
import { ChatMessage, sendChat } from "../lib/ai";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function AiPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Forge Agent ready. Ask for refactors, explanations, or commit messages. Without an API key this panel uses a local stub echo.",
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

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
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const reply = await sendChat(messages, text);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: reply.content,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="panel ai-panel">
      <header className="panel-header">
        <div className="panel-title">Forge Agent</div>
        <span className="badge">AI</span>
      </header>
      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            <div className="chat-role">{m.role === "user" ? "You" : "Agent"}</div>
            <pre>{m.content}</pre>
          </div>
        ))}
        {pending ? (
          <div className="chat-bubble assistant pending">
            <div className="chat-role">Agent</div>
            <pre>Thinking…</pre>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      {error ? <div className="error pad">{error}</div> : null}
      <form className="chat-input" onSubmit={(e) => void onSubmit(e)}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Forge Agent…"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="primary-btn" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
