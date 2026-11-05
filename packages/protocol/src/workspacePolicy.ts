/**
 * Rules shared by the browser (to skip files before uploading) and the server (to enforce).
 * Keeping them in one place guarantees both sides agree on what a project may contain.
 */

/** Directory names never uploaded: dependencies, build output, VCS metadata, caches. */
export const IGNORED_DIRECTORIES = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  ".idea",
  "target",
  "vendor",
  "Pods",
  "coverage",
] as const;

/** File names never uploaded. `.env*` files usually hold secrets, so they stay on the user's machine. */
const IGNORED_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /\.(pem|key|p12|pfx)$/i,
];

/** Env templates are documentation, not secrets: `.env.example`, `.env.sample`, `.env.template`. */
const SAFE_ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i;

export type SkipReason = "ignored-directory" | "secret-or-system-file" | "invalid-path";

export const MAX_PATH_LENGTH = 512;

/**
 * Normalizes a browser-provided relative path ("folder/sub/file.ts") into a safe POSIX path,
 * or returns null when it could escape the project root or is otherwise unusable.
 */
export function normalizeRelativePath(raw: string): string | null {
  if (!raw || raw.length > MAX_PATH_LENGTH || raw.includes("\0")) return null;
  const parts = raw.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    if (/^[a-zA-Z]:$/.test(part) && out.length === 0) return null; // drive letter
    out.push(part);
  }
  return out.length > 0 ? out.join("/") : null;
}

/** Returns why a normalized path must be skipped, or null when it may be uploaded. */
export function skipReason(path: string): SkipReason | null {
  const segments = path.split("/");
  const fileName = segments.at(-1) ?? "";
  if (segments.slice(0, -1).some((s) => (IGNORED_DIRECTORIES as readonly string[]).includes(s))) {
    return "ignored-directory";
  }
  if (SAFE_ENV_TEMPLATE.test(fileName)) return null;
  if (IGNORED_FILE_PATTERNS.some((re) => re.test(fileName))) return "secret-or-system-file";
  return null;
}

/** Drops the top-level folder that browsers prepend to `webkitRelativePath`. */
export function stripRootFolder(path: string): string {
  const index = path.indexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
