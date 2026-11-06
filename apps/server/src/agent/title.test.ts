import { describe, expect, it } from "vitest";
import { buildTitleRequest, cleanTitle, isDefaultTitle, MAX_TITLE_CHARS, shouldRetitle } from "./title.ts";

describe("isDefaultTitle", () => {
  it("recognises the placeholder titles in both languages, and empty", () => {
    for (const t of ["New conversation", "Percakapan baru", "  new conversation ", ""]) {
      expect(isDefaultTitle(t)).toBe(true);
    }
    expect(isDefaultTitle("Tambah server MCP")).toBe(false);
  });
});

describe("shouldRetitle", () => {
  const base = { title: "New conversation", replies: 1, auto: false, lockedByPerson: false };

  it("names a conversation that still has the placeholder", () => {
    expect(shouldRetitle(base)).toBe(true);
    // Even later, when the first reply failed and a later one worked.
    expect(shouldRetitle({ ...base, replies: 3 })).toBe(true);
  });

  it("never touches a title the person wrote, even a placeholder-looking one", () => {
    expect(shouldRetitle({ ...base, lockedByPerson: true })).toBe(false);
    expect(shouldRetitle({ title: "Rencana Q4", replies: 4, auto: false, lockedByPerson: true })).toBe(false);
  });

  it("leaves a title that came from a template or the person alone", () => {
    expect(
      shouldRetitle({ title: "Tambah server MCP", replies: 4, auto: false, lockedByPerson: false }),
    ).toBe(false);
  });

  it("refreshes its own title every fourth reply to follow the topic", () => {
    const own = { title: "Manfaat olahraga pagi", auto: true, lockedByPerson: false };
    expect(shouldRetitle({ ...own, replies: 1 })).toBe(false);
    expect(shouldRetitle({ ...own, replies: 3 })).toBe(false);
    expect(shouldRetitle({ ...own, replies: 4 })).toBe(true);
    expect(shouldRetitle({ ...own, replies: 5 })).toBe(false);
    expect(shouldRetitle({ ...own, replies: 8 })).toBe(true);
  });
});

describe("buildTitleRequest", () => {
  it("uses only the latest messages, shortened, and asks for the title only", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      text: `message-${i} ${"x".repeat(2_000)}`,
    }));
    const req = buildTitleRequest(messages, "New conversation");
    const body = req.messages[0]?.text ?? "";
    expect(body).not.toContain("message-3");
    expect(body).toContain("message-9");
    expect(body.length).toBeLessThan(6 * 700);
    expect(req.system).toContain("Reply with the title only");
    expect(req.system).not.toContain("current title");
  });

  it("tells the model to keep a title that still fits", () => {
    const req = buildTitleRequest([{ role: "user", text: "hi" }], "Manfaat olahraga");
    expect(req.system).toContain('"Manfaat olahraga"');
    expect(req.system).toContain("Keep it exactly");
  });
});

describe("cleanTitle", () => {
  it("strips quotes, markdown, labels and the final period", () => {
    expect(cleanTitle('"Manfaat Olahraga Pagi."')).toBe("Manfaat Olahraga Pagi");
    expect(cleanTitle("**Title:** Rencana Proyek")).toBe("Rencana Proyek");
    expect(cleanTitle("Judul: Ringkasan Rapat\nPenjelasan lain")).toBe("Ringkasan Rapat");
    expect(cleanTitle("  spaced    out   title ")).toBe("spaced out title");
  });

  it("returns nothing for an empty answer and caps a long one", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle('  ""  ')).toBeNull();
    const long = cleanTitle("word ".repeat(40)) ?? "";
    expect(long.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
});
