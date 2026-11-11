/**
 * Pages the assistant makes (dashboards, reports) and how they are shown. Their HTML is written by a model that may have
 * read text an attacker controls, so it is treated as hostile: it only ever runs inside a sandboxed frame, with every way
 * out closed. Pure functions here, shared by the server and the browser, so the rules are tested in one place.
 */

/** Longest page the assistant may save, in characters. */
export const MAX_ARTIFACT_CHARS = 400_000;
export const MAX_ARTIFACT_TITLE = 120;

/** Names of the tools the assistant uses to save a page; the browser uses them to offer the preview. */
export const ARTIFACT_TOOLS = ["create_dashboard", "update_dashboard"] as const;
export const isArtifactTool = (name: string) => (ARTIFACT_TOOLS as readonly string[]).includes(name);

/**
 * What the page itself may do: run its own scripts and styles and show images it carries as data. Nothing is fetched, no
 * form is sent, nothing is embedded. Each directive is set because `default-src` does not cover it (or to be explicit).
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

/** The `sandbox` attribute for the frame: scripts only. No same-origin, popups, forms, downloads or navigating the top page. */
export const PREVIEW_SANDBOX = "allow-scripts";

/** A script is closed by its own end tag, so that text can't appear inside an inlined library. */
const inertScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");

/**
 * The document the frame shows: our own head (the policy, then any bundled libraries such as the chart library),
 * followed by the page exactly as written.
 *
 * The head is always the very first thing in the document, never spliced in where the page's `<head>` appears to be:
 * the page is hostile, and a `<head>` hidden in a comment or a script placed before its `<head>` would otherwise get
 * the policy swallowed or run before it applies. HTML parsing merges the page's own `<html>`/`<head>` tags into ours
 * (its head elements still land in the head), so full documents and fragments both work. A policy of the page's own
 * can only make the frame stricter, never looser. Only the page's leading doctype is dropped; ours keeps standards mode.
 */
export function previewDocument(html: string, libraries: string[] = []): string {
  const page = html.replace(/^﻿/, "").replace(/^\s*<!doctype[^>]*>/i, "");
  const head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    libraries.map((code) => `<script>${inertScript(code)}</script>`).join("");
  return `<!doctype html><html><head>${head}</head>${page}`;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Policy of the downloaded file's outer document. A `srcdoc` frame inherits its parent's policy on top of its own, so
 * the outer policy must allow what the page needs (inline scripts and styles, data: images); everything else is the
 * same closed policy, except that it may frame its inline page. The outer document itself contains no scripts.
 */
export const DOWNLOAD_OUTER_CSP = PREVIEW_CSP.replace("frame-src 'none'", "frame-src about: blob: data:");

/**
 * The file offered by "Download": the page inside the same locked frame the app uses, so opening the file in a browser
 * keeps it contained. The inner document is `previewDocument` (its own network policy), sandboxed to scripts only, so
 * it can't navigate, open windows or reach the network.
 */
export function downloadDocument(title: string, html: string, libraries: string[] = []): string {
  const inner = previewDocument(html, libraries);
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="${DOWNLOAD_OUTER_CSP}">` +
    `<title>${escapeHtml(title)}</title>` +
    "<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%;background:#fff}</style>" +
    `</head><body><iframe sandbox="${PREVIEW_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escapeHtml(inner)}"></iframe></body></html>`
  );
}

/** Why a page can't be saved, or null when it can. */
export function artifactProblem(title: string, html: string): string | null {
  if (!title.trim()) return "The title is empty.";
  if (title.length > MAX_ARTIFACT_TITLE) return `The title is longer than ${MAX_ARTIFACT_TITLE} characters.`;
  if (!html.trim()) return "The page is empty.";
  if (html.length > MAX_ARTIFACT_CHARS)
    return `The page is longer than ${MAX_ARTIFACT_CHARS} characters. Make it smaller.`;
  return null;
}
