#!/usr/bin/env node
/**
 * Looks for secrets in what is about to be committed (or, with --all, in every tracked file) and exits non-zero when it
 * finds one. The repository is public, so a key that is committed once must be treated as leaked.
 * A line that is deliberately fake can carry the marker `secret-scan:allow`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["OpenAI/Anthropic-style key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{40,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Private key block", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{30,}=*/],
  [
    "Database URL with a password",
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:(?!orbs@|password@|\$\{)[^\s@/]{6,}@(?!127\.0\.0\.1|localhost)/,
  ],
  [
    "Secret assigned a long literal",
    /\b(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)[A-Za-z_]*\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']/i,
  ],
];

const SKIP =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$|drizzle\/meta\/|\.(png|jpe?g|gif|webp|ico|woff2?|pdf)$/i;
const FORBIDDEN_FILES =
  /(^|\/)\.env(\.(?!example$).+)?$|\.(pem|p12|pfx|jks|keystore)$|(^|\/)id_(rsa|ed25519)/;

const all = process.argv.includes("--all");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const files = (
  all ? git("ls-files", "-z") : git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
)
  .split("\0")
  .filter(Boolean);

const problems = [];
for (const file of files) {
  if (FORBIDDEN_FILES.test(file)) problems.push(`${file}: a file that holds secrets must not be committed`);
  if (SKIP.test(file)) continue;
  let text;
  try {
    // For a commit, look at what is staged, not what is in the working copy.
    text = all ? readFileSync(file, "utf8") : git("show", `:${file}`);
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  text.split("\n").forEach((line, i) => {
    if (line.includes("secret-scan:allow")) return;
    for (const [name, pattern] of PATTERNS) {
      if (pattern.test(line)) problems.push(`${file}:${i + 1}: ${name}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`Possible secrets found (${problems.length}):\n  ${problems.join("\n  ")}`);
  console.error(
    "\nDon't commit them. If a line is deliberately fake, add the marker `secret-scan:allow` to it.",
  );
  process.exit(1);
}
console.log(`No secrets found in ${files.length} file(s).`);
