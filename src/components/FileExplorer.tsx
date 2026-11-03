import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DirNode, isTauri, listDir, setWorkspace } from "../lib/tauri";
import { fileName } from "../lib/language";

type Props = {
  workspaceRoot: string | null;
  onWorkspaceChange: (root: string | null) => void;
  onOpenFile: (path: string) => void;
  activePath: string | null;
};

type TreeProps = {
  path: string;
  onOpenFile: (path: string) => void;
  activePath: string | null;
};

function TreeNode({ path, onOpenFile, activePath }: TreeProps) {
  const [children, setChildren] = useState<DirNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await listDir(path);
      setChildren(entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="tree-root">
      {loading && children === null ? (
        <div className="muted pad">Loading…</div>
      ) : null}
      {error ? <div className="error pad">{error}</div> : null}
      {children?.map((node) =>
        node.isDir ? (
          <FolderRow
            key={node.path}
            node={node}
            depth={1}
            onOpenFile={onOpenFile}
            activePath={activePath}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            depth={1}
            onOpenFile={onOpenFile}
            activePath={activePath}
          />
        ),
      )}
    </div>
  );
}

function FolderRow({
  node,
  depth,
  onOpenFile,
  activePath,
}: {
  node: DirNode;
  depth: number;
  onOpenFile: (path: string) => void;
  activePath: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoading(true);
      try {
        setChildren(await listDir(node.path));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div>
      <button
        type="button"
        className="tree-item folder"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => void toggle()}
      >
        <span className="chev">{expanded ? "▾" : "▸"}</span>
        <span className="label">{node.name}</span>
      </button>
      {expanded ? (
        <div>
          {loading ? (
            <div className="muted" style={{ paddingLeft: 20 + depth * 12 }}>
              …
            </div>
          ) : null}
          {children?.map((child) =>
            child.isDir ? (
              <FolderRow
                key={child.path}
                node={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                activePath={activePath}
              />
            ) : (
              <FileRow
                key={child.path}
                node={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                activePath={activePath}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({
  node,
  depth,
  onOpenFile,
  activePath,
}: {
  node: DirNode;
  depth: number;
  onOpenFile: (path: string) => void;
  activePath: string | null;
}) {
  const active = activePath === node.path;
  return (
    <button
      type="button"
      className={`tree-item file${active ? " active" : ""}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onOpenFile(node.path)}
      title={node.path}
    >
      <span className="file-dot" />
      <span className="label">{node.name}</span>
    </button>
  );
}

export function FileExplorer({
  workspaceRoot,
  onWorkspaceChange,
  onOpenFile,
  activePath,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFolder = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!isTauri()) {
        const root = await setWorkspace("/demo-workspace");
        onWorkspaceChange(root);
        return;
      }
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Folder — Forge IDE",
      });
      if (typeof selected === "string" && selected) {
        const root = await setWorkspace(selected);
        onWorkspaceChange(root);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel explorer">
      <header className="panel-header">
        <div className="panel-title">Explorer</div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => void openFolder()}
          disabled={busy}
        >
          {busy ? "Opening…" : "Open Folder"}
        </button>
      </header>
      {error ? <div className="error pad">{error}</div> : null}
      {workspaceRoot ? (
        <>
          <div className="workspace-name" title={workspaceRoot}>
            {fileName(workspaceRoot)}
          </div>
          <TreeNode
            path={workspaceRoot}
            onOpenFile={onOpenFile}
            activePath={activePath}
          />
        </>
      ) : (
        <div className="empty-pane">
          <p>No folder open</p>
          <button type="button" className="primary-btn" onClick={() => void openFolder()}>
            Open Folder
          </button>
        </div>
      )}
    </aside>
  );
}
