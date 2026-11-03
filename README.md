# Forge IDE (Deskapp)

Original desktop IDE built with **Tauri 2 + React + TypeScript + Vite + Monaco Editor**.

Forge IDE is a Deskapp product — not affiliated with Cursor. It provides a file explorer, multi-tab Monaco editor, AI agent sidebar (stub / optional API key), and an integrated terminal panel.

## Features

- **Explorer** — open a folder via the native dialog; tree navigation scoped to that workspace
- **Editor** — Monaco multi-tab editing with syntax highlighting, dirty indicators, Ctrl/Cmd+S save
- **Forge Agent** — chat sidebar; local stub by default, optional OpenAI-compatible provider via env
- **Terminal** — command + stdout/stderr runner in the open workspace (not a full PTY)
- **Least-privilege FS** — Rust-side path checks keep reads/writes/commands under the opened folder

## Prerequisites (Windows)

1. [Node.js 20+](https://nodejs.org/) (npm or pnpm)
2. [Rust](https://rustup.rs/) stable toolchain (**1.90+** recommended for current Tauri 2 crates)
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++)
4. WebView2 (usually preinstalled on Windows 10/11; Tauri can bootstrap if missing)

Optional: [pnpm](https://pnpm.io/) (`npm install -g pnpm`)

## Install

```bash
pnpm install
# or: npm install
```

## Develop

```bash
pnpm tauri dev
# or: npm run tauri -- dev
```

Frontend-only (browser preview; Tauri dialogs/FS/terminal unavailable):

```bash
pnpm dev
```

## Build

```bash
pnpm build                 # typecheck + Vite production bundle
pnpm tauri build           # native app + installer (platform-specific)
```

### Windows packaging notes

- `pnpm tauri build` on **Windows** produces `.msi` / `.exe` under `src-tauri/target/release/bundle/`.
- Building Windows installers from **Linux/macOS** is not supported by Tauri’s default pipeline without a Windows host or cross-compile setup (WebView2 + MSVC).
- This repository is developed/verified on Linux CI for frontend typecheck/build and Rust compile where webkit GTK deps exist; ship Windows artifacts from a Windows machine or CI runner.

## Optional LLM provider

Copy `.env.example` to `.env`:

```bash
VITE_LLM_API_KEY=sk-...
VITE_LLM_API_URL=https://api.openai.com/v1/chat/completions
```

Restart `pnpm tauri dev` after changing env vars.

## Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+S | Save active file |
| Ctrl/Cmd+` | Toggle terminal |
| Ctrl/Cmd+L | Toggle agent panel |

## Project layout

```
src/                 React UI (explorer, editor, agent, terminal)
src-tauri/           Tauri 2 host, workspace-scoped FS + command runner
```

## License

Private / as designated by the Deskapp repository owner.
