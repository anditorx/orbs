import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { normalizeRelativePath } from "@orbs/protocol";
import { env } from "./env.ts";

/**
 * Local-disk storage for project workspaces: <ORBS_DATA_DIR>/workspaces/<orgId>/<projectId>/files.
 * Every path is re-validated here so callers cannot escape a project's directory.
 * Swap this module for an S3-compatible implementation when running several servers.
 */
const root = resolve(env.ORBS_DATA_DIR, "workspaces");

function safeId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("invalid id");
  return value;
}

export function projectDir(orgId: string, projectId: string) {
  return resolve(root, safeId(orgId), safeId(projectId), "files");
}

function resolveInside(orgId: string, projectId: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new Error("invalid path");
  const base = projectDir(orgId, projectId);
  const target = resolve(base, normalized);
  if (!target.startsWith(base + sep)) throw new Error("path escapes project");
  return { target, normalized };
}

export async function saveFile(orgId: string, projectId: string, relativePath: string, bytes: Uint8Array) {
  const { target, normalized } = resolveInside(orgId, projectId, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return {
    path: normalized,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function loadFile(orgId: string, projectId: string, relativePath: string, maxBytes: number) {
  const { target } = resolveInside(orgId, projectId, relativePath);
  const info = await stat(target);
  const buffer = await readFile(target);
  return { size: info.size, bytes: buffer.subarray(0, maxBytes), truncated: info.size > maxBytes };
}

export async function removeProject(orgId: string, projectId: string) {
  await rm(resolve(root, safeId(orgId), safeId(projectId)), { recursive: true, force: true });
}
