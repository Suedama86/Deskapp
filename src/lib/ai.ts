export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

export type ChatResponse = {
  content: string;
  provider: "stub" | "openai-compatible";
};

/**
 * Provider-ready chat helper. Without VITE_LLM_API_KEY, returns a local stub echo.
 * Optional env:
 *   VITE_LLM_API_KEY  — bearer token
 *   VITE_LLM_API_URL  — OpenAI-compatible chat completions endpoint
 */
export async function sendChat(
  messages: ChatMessage[],
  userText: string,
): Promise<ChatResponse> {
  const apiKey = import.meta.env.VITE_LLM_API_KEY?.trim();
  const apiUrl =
    import.meta.env.VITE_LLM_API_URL?.trim() ||
    "https://api.openai.com/v1/chat/completions";

  if (!apiKey) {
    await new Promise((r) => setTimeout(r, 280));
    return {
      provider: "stub",
      content: [
        "Forge Agent (local stub)",
        "",
        "No VITE_LLM_API_KEY configured — echoing your request:",
        `> ${userText}`,
        "",
        "Tip: set VITE_LLM_API_KEY (and optionally VITE_LLM_API_URL) in a .env file,",
        "then restart `pnpm tauri dev` to talk to an OpenAI-compatible provider.",
      ].join("\n"),
    };
  }

  const payload = {
    model: "gpt-4o-mini",
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
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM response was empty");
  }

  return { provider: "openai-compatible", content };
}
