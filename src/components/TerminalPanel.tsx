import { FormEvent, useState } from "react";
import { runCommand } from "../lib/tauri";

type Line = {
  id: string;
  kind: "input" | "stdout" | "stderr" | "meta" | "error";
  text: string;
};

type Props = {
  workspaceRoot: string | null;
};

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TerminalPanel({ workspaceRoot }: Props) {
  const [lines, setLines] = useState<Line[]>([
    {
      id: "boot",
      kind: "meta",
      text: "Forge Terminal — command + stdout runner (not a full PTY). Commands run in the open workspace when set.",
    },
  ]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);

  const append = (entries: Omit<Line, "id">[]) => {
    setLines((prev) => [...prev, ...entries.map((e) => ({ ...e, id: uid() }))]);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;

    setBusy(true);
    append([{ kind: "input", text: `$ ${cmd}` }]);
    setCommand("");

    try {
      const result = await runCommand(cmd, workspaceRoot);
      const next: Omit<Line, "id">[] = [];
      if (result.stdout) next.push({ kind: "stdout", text: result.stdout.replace(/\n$/, "") });
      if (result.stderr) next.push({ kind: "stderr", text: result.stderr.replace(/\n$/, "") });
      next.push({
        kind: "meta",
        text: `[exit ${result.exitCode ?? "?"}] cwd: ${result.cwd}`,
      });
      append(next);
    } catch (err) {
      append([
        {
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel terminal-panel">
      <header className="panel-header">
        <div className="panel-title">Terminal</div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() =>
            setLines([
              {
                id: uid(),
                kind: "meta",
                text: "Cleared.",
              },
            ])
          }
        >
          Clear
        </button>
      </header>
      <div className="terminal-log">
        {lines.map((line) => (
          <pre key={line.id} className={`term-line ${line.kind}`}>
            {line.text}
          </pre>
        ))}
      </div>
      <form className="terminal-input" onSubmit={(e) => void onSubmit(e)}>
        <span className="prompt">❯</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={busy ? "Running…" : "Enter a command"}
          disabled={busy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </form>
    </section>
  );
}
