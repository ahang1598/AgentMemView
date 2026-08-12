import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Shared backup/restore helpers for onboard adapters.
 * Convention: `<file>.agentmemview.bak` holds the pre-install content;
 * `<file>.agentmemview.created` marks that install created the file fresh
 * (restore then deletes it instead of writing back an empty backup).
 */

export function backupPath(file: string): string {
  return `${file}.agentmemview.bak`;
}

export function createdMarker(file: string): string {
  return `${file}.agentmemview.created`;
}

export function backupBeforeChange(file: string): void {
  if (!existsSync(file)) {
    return;
  }
  if (!existsSync(backupPath(file))) {
    copyFileSync(file, backupPath(file));
  }
}

export function markCreated(file: string): void {
  writeFileSync(createdMarker(file), new Date().toISOString(), "utf8");
}

export function ensureDir(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
}

export function restoreFile(file: string): void {
  const marker = createdMarker(file);
  const backup = backupPath(file);
  if (existsSync(marker)) {
    rmSync(file, { force: true });
    rmSync(marker, { force: true });
    rmSync(backup, { force: true });
    return;
  }
  if (existsSync(backup)) {
    copyFileSync(backup, file);
    rmSync(backup, { force: true });
  }
}

export function readJsonOrDefault(file: string): Record<string, unknown> {
  if (!existsSync(file)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
