import { useCallback, useEffect, useState } from "react";
import { AiPanel } from "./components/AiPanel";
import { EditorPane, EditorTab } from "./components/EditorPane";
import { FileExplorer } from "./components/FileExplorer";
import { TerminalPanel } from "./components/TerminalPanel";
import { isTauri, readFile, writeFile } from "./lib/tauri";
import "./App.css";

export default function App() {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);

  const openFile = useCallback(async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActivePath(path);
      return;
    }
    setStatus(`Opening ${path}…`);
    try {
      const value = await readFile(path);
      setTabs((prev) => [
        ...prev,
        { path, value, original: value, dirty: false },
      ]);
      setActivePath(path);
      setStatus("Ready");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, [tabs]);

  const onChange = (path: string, value: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path === path ? { ...t, value, dirty: value !== t.original } : t,
      ),
    );
  };

  const onClose = (path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activePath === path) {
        setActivePath(next[next.length - 1]?.path ?? null);
      }
      return next;
    });
  };

  const onSave = useCallback(async (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return;
    setStatus(`Saving ${path}…`);
    try {
      await writeFile(path, tab.value);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path ? { ...t, original: t.value, dirty: false } : t,
        ),
      );
      setStatus("Saved");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, [tabs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activePath) void onSave(activePath);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "`") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setChatOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath, onSave]);

  return (
    <div className="ide-shell">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-glyph" aria-hidden />
          <span className="brand-name">Forge IDE</span>
          <span className="brand-sub">Deskapp</span>
        </div>
        <div className="titlebar-actions">
          <button
            type="button"
            className={`ghost-btn${chatOpen ? " on" : ""}`}
            onClick={() => setChatOpen((v) => !v)}
            title="Toggle agent panel (Ctrl+L)"
          >
            Agent
          </button>
          <button
            type="button"
            className={`ghost-btn${terminalOpen ? " on" : ""}`}
            onClick={() => setTerminalOpen((v) => !v)}
            title="Toggle terminal (Ctrl+`)"
          >
            Terminal
          </button>
        </div>
      </header>

      <div
        className="ide-main"
        style={{
          gridTemplateColumns: chatOpen
            ? "260px minmax(0, 1fr) 320px"
            : "260px minmax(0, 1fr)",
        }}
      >
        <FileExplorer
          workspaceRoot={workspaceRoot}
          onWorkspaceChange={setWorkspaceRoot}
          onOpenFile={(path) => void openFile(path)}
          activePath={activePath}
        />

        <div className="center-column">
          <EditorPane
            tabs={tabs}
            activePath={activePath}
            onSelect={setActivePath}
            onClose={onClose}
            onChange={onChange}
            onSave={(path) => void onSave(path)}
          />
          {terminalOpen ? <TerminalPanel workspaceRoot={workspaceRoot} /> : null}
        </div>

        {chatOpen ? <AiPanel /> : null}
      </div>

      <footer className="statusbar">
        <span>{status}</span>
        <span className="status-right">
          {workspaceRoot ? workspaceRoot : "No workspace"}
          {" · "}
          {isTauri() ? "Tauri" : "Browser preview"}
        </span>
      </footer>
    </div>
  );
}
