import { describe, expect, it } from "vitest";
import { normalizeRelativePath, skipReason, stripRootFolder } from "./workspacePolicy.ts";

describe("normalizeRelativePath", () => {
  it("normalizes separators and dots", () => {
    expect(normalizeRelativePath("src\\\\app/./main.ts")).toBe("src/app/main.ts");
  });
  it("rejects traversal, absolute drive letters and null bytes", () => {
    expect(normalizeRelativePath("../etc/passwd")).toBeNull();
    expect(normalizeRelativePath("src/../../x")).toBeNull();
    expect(normalizeRelativePath("C:/Windows/x")).toBeNull();
    expect(normalizeRelativePath("a\\0b")).not.toBeNull();
    expect(normalizeRelativePath("a\u0000b")).toBeNull();
    expect(normalizeRelativePath("")).toBeNull();
  });
  it("treats a leading slash as relative", () => {
    expect(normalizeRelativePath("/src/a.ts")).toBe("src/a.ts");
  });
});

describe("skipReason", () => {
  it("skips dependency and build folders anywhere in the path", () => {
    expect(skipReason("node_modules/react/index.js")).toBe("ignored-directory");
    expect(skipReason("apps/web/dist/main.js")).toBe("ignored-directory");
  });
  it("skips secrets and system files", () => {
    expect(skipReason(".env")).toBe("secret-or-system-file");
    expect(skipReason("config/.env.production")).toBe("secret-or-system-file");
    expect(skipReason("certs/server.key")).toBe("secret-or-system-file");
  });
  it("keeps ordinary source files, including names that merely contain ignored words", () => {
    expect(skipReason("src/build-utils.ts")).toBeNull();
    expect(skipReason(".env.example")).toBeNull();
    expect(skipReason(".env.local")).toBe("secret-or-system-file");
    expect(skipReason("docs/environment.md")).toBeNull();
  });
});

describe("stripRootFolder", () => {
  it("removes the selected folder name", () => {
    expect(stripRootFolder("my-app/src/index.ts")).toBe("src/index.ts");
    expect(stripRootFolder("README.md")).toBe("README.md");
  });
});
