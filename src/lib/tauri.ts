import { invoke } from "@tauri-apps/api/core";
import { demoApi } from "./demoFs";

export type DirNode = {
  name: string;
  path: string;
  isDir: boolean;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd: string;
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function setWorkspace(path: string): Promise<string> {
  if (!isTauri()) return demoApi.setWorkspace();
  return invoke<string>("set_workspace", { path });
}

export async function getWorkspace(): Promise<string | null> {
  if (!isTauri()) return demoApi.root;
  return invoke<string | null>("get_workspace");
}

export async function listDir(path: string): Promise<DirNode[]> {
  if (!isTauri()) return demoApi.listDir(path);
  return invoke<DirNode[]>("list_dir", { path });
}

export async function readFile(path: string): Promise<string> {
  if (!isTauri()) return demoApi.readFile(path);
  return invoke<string>("read_file", { path });
}

export async function writeFile(path: string, contents: string): Promise<void> {
  if (!isTauri()) return demoApi.writeFile(path, contents);
  return invoke("write_file", { path, contents });
}

export async function runCommand(
  command: string,
  cwd?: string | null,
): Promise<CommandResult> {
  if (!isTauri()) return demoApi.runCommand(command);
  return invoke<CommandResult>("run_command", { command, cwd: cwd ?? null });
}
