import type { CommandResult, DirNode } from "./tauri";

const DEMO_ROOT = "/demo-workspace";

const FILES: Record<string, string> = {
  [`${DEMO_ROOT}/README.md`]: `# Forge demo workspace

This browser preview uses an in-memory demo filesystem.
Run \`pnpm tauri dev\` for real folders, save, and terminal.
`,
  [`${DEMO_ROOT}/package.json`]: `{
  "name": "forge-demo",
  "private": true,
  "version": "0.1.0"
}
`,
  [`${DEMO_ROOT}/src/main.rs`]: `fn main() {
    println!("Hello from Forge IDE");
}
`,
  [`${DEMO_ROOT}/src/lib.rs`]: `pub fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}
`,
};

function childrenOf(dir: string): DirNode[] {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const names = new Set<string>();
  const nodes: DirNode[] = [];

  for (const path of Object.keys(FILES)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const segment = rest.split("/")[0];
    if (!segment || names.has(segment)) continue;
    names.add(segment);
    const full = `${prefix}${segment}`;
    const isDir = Object.keys(FILES).some(
      (p) => p.startsWith(`${full}/`) || (p !== full && p.startsWith(full)),
    ) && !FILES[full];
    nodes.push({
      name: segment,
      path: full,
      isDir: isDir || Object.keys(FILES).some((p) => p.startsWith(`${full}/`)),
    });
  }

  // Fix isDir for paths that are only directories
  return nodes
    .map((n) => ({
      ...n,
      isDir: !FILES[n.path],
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export const demoApi = {
  root: DEMO_ROOT,
  setWorkspace: async () => DEMO_ROOT,
  listDir: async (path: string): Promise<DirNode[]> => childrenOf(path),
  readFile: async (path: string): Promise<string> => {
    const content = FILES[path];
    if (content === undefined) throw new Error(`Demo file not found: ${path}`);
    return content;
  },
  writeFile: async (path: string, contents: string): Promise<void> => {
    FILES[path] = contents;
  },
  runCommand: async (command: string): Promise<CommandResult> => ({
    stdout: `[demo] simulated output for: ${command}\nforge-demo 0.1.0`,
    stderr: "",
    exitCode: 0,
    cwd: DEMO_ROOT,
  }),
};
