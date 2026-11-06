import { describe, expect, it } from "vitest";
import { parseGeminiCurl } from "./curl.ts";

describe("parseGeminiCurl", () => {
  it("reads the AI Studio snippet (header key, multi-line, single quotes)", () => {
    const text = `curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \\
  -H 'Content-Type: application/json' \\
  -H 'X-goog-api-key: AIzaSyEXAMPLE-key_123' \\
  -X POST \\
  -d '{"contents":[{"parts":[{"text":"Explain how AI works"}]}]}'`;
    expect(parseGeminiCurl(text)).toEqual({ apiKey: "AIzaSyEXAMPLE-key_123", model: "gemini-2.5-flash" });
  });
  it("reads a key passed in the query string", () => {
    expect(
      parseGeminiCurl(
        "curl 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaQuery' -d '{}'",
      ),
    ).toEqual({ apiKey: "AIzaQuery", model: "gemini-2.0-flash" });
  });
  it("reads the project from a header, as a number or a name", () => {
    expect(
      parseGeminiCurl("curl https://x.test -H 'x-goog-user-project: 1234567890' -H 'x-goog-api-key: k'"),
    ).toMatchObject({
      apiKey: "k",
      projectNumber: "1234567890",
    });
    expect(parseGeminiCurl("curl https://x.test --header 'x-goog-user-project: my-project'")).toMatchObject({
      projectName: "my-project",
    });
  });
  it("ignores bearer tokens, which are not API keys", () => {
    expect(
      parseGeminiCurl("curl https://x.test -H 'Authorization: Bearer ya29.token'").apiKey,
    ).toBeUndefined();
  });
  it("returns nothing for text that isn't a curl command", () => {
    expect(parseGeminiCurl("hello world")).toEqual({});
    expect(parseGeminiCurl("")).toEqual({});
  });
  it("handles double-quoted headers and unbalanced quotes without throwing", () => {
    expect(parseGeminiCurl(`curl https://x.test -H "x-goog-api-key: abc"`).apiKey).toBe("abc");
    expect(() => parseGeminiCurl(`curl 'https://x.test -H "x`)).not.toThrow();
  });
});

import { parseProviderPrompt } from "./curl.ts";

describe("parseProviderPrompt", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
  it("reads labelled lines", () => {
    expect(
      parseProviderPrompt(
        `Name: Production\nAPI key: ${KEY}\nProject name: my-proj\nProject number: 1234567890`,
      ),
    ).toEqual({ name: "Production", apiKey: KEY, projectName: "my-proj", projectNumber: "1234567890" });
  });
  it("accepts a bare key on its own", () => {
    expect(parseProviderPrompt(`  ${KEY}\n`)).toEqual({ apiKey: KEY });
    expect(parseProviderPrompt(`here is my key ${KEY} thanks`)).toEqual({ apiKey: KEY });
  });
  it("combines a curl command with labelled lines, which win", () => {
    const text = `Name: Main\nProject name: p1\ncurl https://x.test -H 'x-goog-api-key: ${KEY}' -H 'x-goog-user-project: 111'\nProject number: 222`;
    expect(parseProviderPrompt(text)).toEqual({
      name: "Main",
      apiKey: KEY,
      projectName: "p1",
      projectNumber: "222",
    });
  });
  it("tolerates bullets, quotes and = separators", () => {
    expect(parseProviderPrompt(`- api_key = "${KEY}"\n* project number: 'No. 12 34'`)).toMatchObject({
      apiKey: KEY,
      projectNumber: "1234",
    });
  });
  it("understands Indonesian labels and ignores empty template lines", () => {
    expect(
      parseProviderPrompt(`Nama: Produksi\nKunci API: ${KEY}\nNama proyek: proyekku\nNomor proyek: 42`),
    ).toEqual({ name: "Produksi", apiKey: KEY, projectName: "proyekku", projectNumber: "42" });
    expect(parseProviderPrompt("Name:\nAPI key:\nProject name:\nProject number:")).toEqual({});
  });
  it("reads which provider was named, in either language", () => {
    expect(parseProviderPrompt(`Provider: Gemini\nAPI key: ${KEY}`)).toEqual({
      provider: "Gemini",
      apiKey: KEY,
    });
    expect(parseProviderPrompt(`Penyedia: gemini\nKunci API: ${KEY}`)).toMatchObject({ provider: "gemini" });
  });
  it("finds nothing in unrelated text", () => {
    expect(parseProviderPrompt("hello, please connect gemini")).toEqual({});
  });
});
