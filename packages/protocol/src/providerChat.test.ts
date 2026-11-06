import { describe, expect, it } from "vitest";
import { emptyProviderChat, redactKey, replyToProviderChat } from "./providerChat.ts";

const PROVIDERS = [{ id: "gemini", name: "Gemini" }];
const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
const say = (state: ReturnType<typeof emptyProviderChat>, text: string) =>
  replyToProviderChat(state, text, PROVIDERS);

describe("provider setup conversation", () => {
  it("asks for the provider first when the opening message doesn't say which", () => {
    const r = say(
      emptyProviderChat(),
      "/add-new-model-provider Help me add a new model provider. Start by asking for its name and connection details.",
    );
    expect(r.ask).toBe("provider");
  });

  it("then asks for the key, then for optional labels, then is ready", () => {
    let r = say(emptyProviderChat(), "help me add a provider");
    r = say(r.state, "Gemini");
    expect(r.ask).toBe("key");
    r = say(r.state, KEY);
    expect(r.ask).toBe("labels");
    expect(r.state.apiKey).toBe(KEY);
    r = say(r.state, "skip");
    expect(r.ask).toBe("ready");
    expect(r.state).toMatchObject({ provider: "gemini", apiKey: KEY });
    expect(r.state.name).toBeUndefined();
  });

  it("takes a short free-text answer to the labels question as the name", () => {
    let r = say(emptyProviderChat("gemini"), KEY);
    expect(r.ask).toBe("labels");
    r = say(r.state, "Production");
    expect(r.ask).toBe("ready");
    expect(r.state.name).toBe("Production");
  });

  it("skips every question it already has the answer to", () => {
    const r = say(emptyProviderChat(), `Provider: Gemini\nName: Main\nAPI key: ${KEY}`);
    expect(r.ask).toBe("ready");
    expect(r.state).toMatchObject({ provider: "gemini", name: "Main", apiKey: KEY });
  });

  it("understands a pasted curl command as the key, and Indonesian wording", () => {
    const curl = `curl https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent -H 'x-goog-api-key: ${KEY}'`;
    expect(say(emptyProviderChat("gemini"), curl).state.apiKey).toBe(KEY);
    const id = say(emptyProviderChat(), `Penyedia: gemini\nKunci API: ${KEY}\nNama proyek: proyekku`);
    expect(id.ask).toBe("ready");
    expect(id.state.projectName).toBe("proyekku");
  });

  it("says so when the provider isn't supported, and when no key can be found", () => {
    let r = say(emptyProviderChat(), "help");
    r = say(r.state, "OpenAI");
    expect(r.ask).toBe("unknownProvider");
    r = say(r.state, "gemini");
    expect(r.ask).toBe("key");
    r = say(r.state, "I don't have it yet");
    expect(r.ask).toBe("noKey");
    r = say(r.state, "API key: YOUR_API_KEY");
    expect(r.ask).toBe("placeholderKey");
    r = say(r.state, KEY);
    expect(r.ask).toBe("labels");
  });

  it("accepts a bare long token as the key only when it was just asked for", () => {
    expect(say(emptyProviderChat("gemini"), "x".repeat(30)).state.apiKey).toBeUndefined();
    const asked = say(emptyProviderChat("gemini"), "hello");
    expect(asked.ask).toBe("key");
    expect(say(asked.state, "y".repeat(30)).state.apiKey).toBe("y".repeat(30));
  });
});

describe("redactKey", () => {
  it("replaces every copy of the key with its last four characters", () => {
    expect(redactKey(`key ${KEY} and ${KEY}`, KEY)).toBe(`key ••••${KEY.slice(-4)} and ••••${KEY.slice(-4)}`);
    expect(redactKey("nothing here", undefined)).toBe("nothing here");
  });
});
