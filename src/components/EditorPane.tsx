import Editor from "@monaco-editor/react";
import { languageFromPath, fileName } from "../lib/language";

export type EditorTab = {
  path: string;
  value: string;
  dirty: boolean;
  original: string;
};

type Props = {
  tabs: EditorTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, value: string) => void;
  onSave: (path: string) => void;
};

export function EditorPane({
  tabs,
  activePath,
  onSelect,
  onClose,
  onChange,
  onSave,
}: Props) {
  const active = tabs.find((t) => t.path === activePath) ?? null;

  return (
    <section className="panel editor-pane">
      <div className="tab-bar">
        {tabs.length === 0 ? (
          <div className="tab placeholder">No file open</div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.path}
              className={`tab${tab.path === activePath ? " active" : ""}`}
              title={tab.path}
            >
              <button type="button" className="tab-label" onClick={() => onSelect(tab.path)}>
                {fileName(tab.path)}
                {tab.dirty ? " •" : ""}
              </button>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${fileName(tab.path)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.path);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
        <div className="tab-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={!active?.dirty}
            onClick={() => active && onSave(active.path)}
            title="Save (Ctrl+S)"
          >
            Save
          </button>
        </div>
      </div>
      <div className="editor-body">
        {active ? (
          <Editor
            key={active.path}
            height="100%"
            theme="vs-dark"
            path={active.path}
            language={languageFromPath(active.path)}
            value={active.value}
            onChange={(v) => onChange(active.path, v ?? "")}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
              minimap: { enabled: true, scale: 0.8 },
              smoothScrolling: true,
              cursorBlinking: "smooth",
              automaticLayout: true,
              padding: { top: 12 },
              renderLineHighlight: "line",
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            }}
            onMount={(editor, monaco) => {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                onSave(active.path);
              });
            }}
          />
        ) : (
          <div className="empty-pane editor-empty">
            <div className="brand-mark">Forge</div>
            <h2>Open a file to start editing</h2>
            <p>Use the explorer on the left, or open a folder to begin.</p>
          </div>
        )}
      </div>
    </section>
  );
}
