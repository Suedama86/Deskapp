export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

export type ChatProvider = "stub" | "openai-compatible";

export type ChatStatus =
  | { phase: "idle" }
  | { phase: "connecting"; provider: ChatProvider }
  | { phase: "streaming"; provider: ChatProvider }
  | { phase: "error"; message: string }
  | { phase: "done"; provider: ChatProvider };

export type StreamHandlers = {
  onStatus?: (status: ChatStatus) => void;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
};

function envProvider(): { apiKey?: string; apiUrl: string; model: string } {
  return {
    apiKey: import.meta.env.VITE_LLM_API_KEY?.trim() || undefined,
    apiUrl:
      import.meta.env.VITE_LLM_API_URL?.trim() ||
      "https://api.openai.com/v1/chat/completions",
    model: import.meta.env.VITE_LLM_MODEL?.trim() || "gpt-4o-mini",
  };
}

export function detectProvider(): ChatProvider {
  return envProvider().apiKey ? "openai-compatible" : "stub";
}

function stubReply(userText: string): string {
  return [
    "Forge Agent (local stub · streaming)",
    "",
    "No VITE_LLM_API_KEY configured — echoing your request:",
    `> ${userText}`,
    "",
    "Tip: set VITE_LLM_API_KEY (and optionally VITE_LLM_API_URL / VITE_LLM_MODEL)",
    "in a .env file, then restart `pnpm tauri dev` for an OpenAI-compatible provider.",
  ].join("\n");
}

async function streamStub(
  userText: string,
  handlers: StreamHandlers,
): Promise<{ content: string; provider: ChatProvider }> {
  handlers.onStatus?.({ phase: "connecting", provider: "stub" });
  await delay(120, handlers.signal);
  handlers.onStatus?.({ phase: "streaming", provider: "stub" });

  const full = stubReply(userText);
  let content = "";
  // Stream by small chunks so the UI can animate without an API key.
  for (const chunk of chunkText(full, 18)) {
    throwIfAborted(handlers.signal);
    content += chunk;
    handlers.onChunk?.(chunk);
    await delay(18, handlers.signal);
  }
  handlers.onStatus?.({ phase: "done", provider: "stub" });
  return { content, provider: "stub" };
}

async function streamOpenAI(
  messages: ChatMessage[],
  userText: string,
  handlers: StreamHandlers,
): Promise<{ content: string; provider: ChatProvider }> {
  const { apiKey, apiUrl, model } = envProvider();
  if (!apiKey) {
    throw new Error("Missing VITE_LLM_API_KEY");
  }

  handlers.onStatus?.({ phase: "connecting", provider: "openai-compatible" });

  const payload = {
    model,
    stream: true,
    messages: [
      {
        role: "system",
        content:
          "You are Forge Agent, an assistant inside Forge IDE (Deskapp). Be concise and practical.",
      },
      ...messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ],
  };

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: handlers.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 240)}`);
  }

  handlers.onStatus?.({ phase: "streaming", provider: "openai-compatible" });

  if (!res.body) {
    // Non-streaming fallback if the provider ignored stream:true
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) throw new Error("LLM response was empty");
    handlers.onChunk?.(content);
    handlers.onStatus?.({ phase: "done", provider: "openai-compatible" });
    return { content, provider: "openai-compatible" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    throwIfAborted(handlers.signal);
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          handlers.onChunk?.(delta);
        }
      } catch {
        // Ignore malformed SSE chunks from partial reads.
      }
    }
  }

  if (!content.trim()) {
    throw new Error("LLM stream completed with empty content");
  }

  handlers.onStatus?.({ phase: "done", provider: "openai-compatible" });
  return { content, provider: "openai-compatible" };
}

/**
 * Streaming chat helper. Without VITE_LLM_API_KEY, uses a local stub that
 * still streams into the UI. Optional env:
 *   VITE_LLM_API_KEY / VITE_LLM_API_URL / VITE_LLM_MODEL
 */
export async function streamChat(
  messages: ChatMessage[],
  userText: string,
  handlers: StreamHandlers = {},
): Promise<{ content: string; provider: ChatProvider }> {
  try {
    if (!envProvider().apiKey) {
      return await streamStub(userText, handlers);
    }
    return await streamOpenAI(messages, userText, handlers);
  } catch (err) {
    if (handlers.signal?.aborted) {
      handlers.onStatus?.({ phase: "idle" });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    handlers.onStatus?.({ phase: "error", message });
    throw err;
  }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
