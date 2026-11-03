import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import {
  cancelCommand,
  isTauri,
  ptyKill,
  ptyResize,
  ptyStart,
  ptyWrite,
  runCommand,
} from "../lib/tauri";

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

function shortPath(path: string | null): string {
  if (!path) return "~";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/** Interactive PTY terminal backed by portable-pty + xterm.js (Tauri only). */
function PtyTerminal({ workspaceRoot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<number | null>(null);
  const [status, setStatus] = useState("Starting PTY…");
  const [error, setError] = useState<string | null>(null);

  const restart = useCallback(async () => {
    setError(null);
    setStatus("Starting PTY…");
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    if (sessionRef.current != null) {
      try {
        await ptyKill(sessionRef.current);
      } catch {
        // ignore
      }
      sessionRef.current = null;
    }

    term.reset();
    fit.fit();
    const cols = term.cols;
    const rows = term.rows;
    try {
      const id = await ptyStart(cols, rows, workspaceRoot);
      sessionRef.current = id;
      setStatus(`PTY #${id} · ${shortPath(workspaceRoot)}`);
      term.focus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("PTY failed");
      term.writeln(`\r\n\x1b[31mPTY error: ${msg}\x1b[0m`);
      term.writeln("Fall back: use browser preview command runner, or fix shell/PTY deps.");
    }
  }, [workspaceRoot]);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0a0d11",
        foreground: "#d7e4f5",
        cursor: "#3ecf8e",
        selectionBackground: "#2a4a3a",
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const unsubs: Array<() => void> = [];
    let disposed = false;

    void (async () => {
      const u1 = await listen<{ id: number; data: string }>("pty-output", (ev) => {
        if (sessionRef.current === ev.payload.id) {
          term.write(ev.payload.data);
        }
      });
      const u2 = await listen<{ id: number; code: number | null }>("pty-exit", (ev) => {
        if (sessionRef.current === ev.payload.id) {
          term.writeln(`\r\n\x1b[90m[process exited ${ev.payload.code ?? "?"}]`);
          setStatus(`Exited (${ev.payload.code ?? "?"})`);
          sessionRef.current = null;
        }
      });
      if (disposed) {
        u1();
        u2();
        return;
      }
      unsubs.push(u1, u2);
      await restart();
    })();

    const onData = term.onData((data) => {
      const id = sessionRef.current;
      if (id == null) return;
      void ptyWrite(id, data).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const id = sessionRef.current;
        if (id != null) {
          void ptyResize(id, term.cols, term.rows);
        }
      } catch {
        // ignore fit races while collapsing the panel
      }
    });
    ro.observe(hostRef.current);

    return () => {
      disposed = true;
      onData.dispose();
      ro.disconnect();
      unsubs.forEach((u) => u());
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id != null) void ptyKill(id);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [restart]);

  return (
    <section className="panel terminal-panel pty">
      <header className="panel-header">
        <div className="panel-title">Terminal</div>
        <div className="terminal-toolbar">
          <span className="term-status" title={workspaceRoot ?? undefined}>
            {status}
          </span>
          <button type="button" className="ghost-btn" onClick={() => void restart()}>
            Restart
          </button>
          <button
            type="button"
            className="ghost-btn danger"
            onClick={() => {
              const id = sessionRef.current;
              if (id != null) void ptyKill(id);
            }}
          >
            Kill
          </button>
        </div>
      </header>
      {error ? <div className="error pad">{error}</div> : null}
      <div className="xterm-host" ref={hostRef} />
    </section>
  );
}

/** Improved one-shot command runner (browser demo / PTY fallback UX). */
function CommandRunnerTerminal({ workspaceRoot }: Props) {
  const [lines, setLines] = useState<Line[]>([
    {
      id: "boot",
      kind: "meta",
      text: "Forge command runner — cwd-aware, cancellable, with history (↑/↓). Interactive PTY is used inside the Tauri app.",
    },
  ]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const append = (entries: Omit<Line, "id">[]) => {
    setLines((prev) => [...prev, ...entries.map((e) => ({ ...e, id: uid() }))]);
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, busy]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;

    setBusy(true);
    setHistory((h) => (h[h.length - 1] === cmd ? h : [...h, cmd]));
    setHistIdx(null);
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

  const onCancel = async () => {
    try {
      await cancelCommand();
      append([{ kind: "meta", text: "[cancel requested]" }]);
    } catch (err) {
      append([
        {
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    }
  };

  return (
    <section className="panel terminal-panel">
      <header className="panel-header">
        <div className="panel-title">Terminal</div>
        <div className="terminal-toolbar">
          <span className="term-status" title={workspaceRoot ?? undefined}>
            cwd: {shortPath(workspaceRoot)}
          </span>
          {busy ? (
            <button type="button" className="ghost-btn danger" onClick={() => void onCancel()}>
              Cancel
            </button>
          ) : null}
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
        </div>
      </header>
      <div className="terminal-log" ref={logRef}>
        {lines.map((line) => (
          <pre key={line.id} className={`term-line ${line.kind}`}>
            {line.text}
          </pre>
        ))}
        {busy ? <pre className="term-line meta">Running…</pre> : null}
      </div>
      <form className="terminal-input" onSubmit={(e) => void onSubmit(e)}>
        <span className="prompt">❯</span>
        <input
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            setHistIdx(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (history.length === 0) return;
              const next =
                histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
              setHistIdx(next);
              setCommand(history[next] ?? "");
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (histIdx === null) return;
              const next = histIdx + 1;
              if (next >= history.length) {
                setHistIdx(null);
                setCommand("");
              } else {
                setHistIdx(next);
                setCommand(history[next] ?? "");
              }
            }
          }}
          placeholder={busy ? "Running… (Cancel to stop)" : "Enter a command"}
          disabled={busy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </form>
    </section>
  );
}

export function TerminalPanel({ workspaceRoot }: Props) {
  if (isTauri()) {
    return <PtyTerminal workspaceRoot={workspaceRoot} />;
  }
  return <CommandRunnerTerminal workspaceRoot={workspaceRoot} />;
}
