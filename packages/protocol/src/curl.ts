/**
 * Reads the values Orbs needs out of a pasted `curl` command, such as the one Google AI Studio shows
 * under "Get code". Pure and tolerant: anything it can't find is simply left out.
 */
export interface ParsedGeminiCurl {
  apiKey?: string;
  projectName?: string;
  projectNumber?: string;
  model?: string;
}

/** Splits a command line into words, honouring single and double quotes and `\` line continuations. */
function tokenize(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, " ");
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < text.length) current += text[++i];
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) words.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started || current) words.push(current);
  return words;
}

export function parseGeminiCurl(input: string): ParsedGeminiCurl {
  const out: ParsedGeminiCurl = {};
  const words = tokenize(input);
  const headers: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if ((w === "-H" || w === "--header") && words[i + 1]) headers.push(words[++i] as string);
    else if (w.startsWith("--header=")) headers.push(w.slice("--header=".length));
  }
  for (const header of headers) {
    const at = header.indexOf(":");
    if (at < 0) continue;
    const name = header.slice(0, at).trim().toLowerCase();
    const value = header.slice(at + 1).trim();
    if (!value) continue;
    // Only a real API key counts. A bearer token is a short-lived OAuth token, not what we store.
    if (name === "x-goog-api-key") out.apiKey = value;
    if (name === "x-goog-user-project") {
      if (/^\d+$/.test(value)) out.projectNumber = value;
      else out.projectName = value;
    }
  }
  const urlWord = words.find((w) => /^https?:\/\//i.test(w));
  if (urlWord) {
    try {
      const url = new URL(urlWord);
      const key = url.searchParams.get("key");
      if (key && !out.apiKey) out.apiKey = key;
      const model = url.pathname.match(/\/models\/([^/:]+)/)?.[1];
      if (model) out.model = model;
      const project = url.pathname.match(/\/projects\/([^/]+)/)?.[1];
      if (project) {
        if (/^\d+$/.test(project)) out.projectNumber ??= project;
        else out.projectName ??= project;
      }
    } catch {
      // Not a parseable address; ignore it.
    }
  }
  return out;
}

export interface ParsedProviderPrompt extends ParsedGeminiCurl {
  /** Which provider the person named ("Provider: Gemini"). */
  provider?: string;
  /** A label the person gave this credential ("Name: Production"). */
  name?: string;
}

/** Google API keys start with "AIza" and are 39 characters long. */
const GOOGLE_KEY = /\bAIza[0-9A-Za-z_-]{35}\b/;

/**
 * Reads everything Orbs needs from one pasted block of text: a curl command (as AI Studio shows it),
 * labelled lines ("API key: …", "Project name: …", "Project number: …", "Name: …"), or just the bare key.
 * Labelled lines win over what the curl command implies, because the person wrote them on purpose.
 */
export function parseProviderPrompt(input: string): ParsedProviderPrompt {
  const out: ParsedProviderPrompt = { ...parseGeminiCurl(input) };
  for (const raw of input.split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*•]?\s*([A-Za-z][A-Za-z _-]{1,24}?)\s*[:=]\s*(.+?)\s*$/);
    const label = m?.[1];
    const value = m?.[2]?.replace(/^["'`]|["'`]$/g, "").trim();
    if (!label || !value) continue;
    switch (label.toLowerCase().replace(/[\s_-]+/g, " ")) {
      case "provider":
      case "penyedia":
        out.provider = value;
        break;
      case "name":
      case "nama":
      case "label":
        out.name = value;
        break;
      case "api key":
      case "apikey":
      case "key":
      case "kunci api":
      case "kunci":
        out.apiKey = value;
        break;
      case "project name":
      case "nama proyek":
      case "project":
        out.projectName = value;
        break;
      case "project number":
      case "nomor proyek":
      case "project no":
      case "project id number":
        out.projectNumber = value.replace(/\D/g, "") || value;
        break;
    }
  }
  if (!out.apiKey) {
    const bare = input.match(GOOGLE_KEY)?.[0];
    if (bare) out.apiKey = bare;
  }
  return out;
}
