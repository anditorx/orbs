import { describe, expect, it } from "vitest";
import {
  appliesHere,
  INSTRUCTION_LIMIT,
  type InstructionLike,
  instructionChars,
  instructionTier,
  instructionUsage,
  MAX_INSTRUCTION_CHARS,
  mayShareWithWorkspace,
  worstCaseChars,
} from "./instructions.ts";

const item = (over: Partial<InstructionLike> & { chars?: number } = {}): InstructionLike => {
  const { chars, ...rest } = over;
  return {
    scope: "user",
    appliesTo: "all",
    projectIds: [],
    ownerId: "me",
    enabled: true,
    name: "n",
    body: "x".repeat(chars ?? 10),
    ...rest,
  };
};
const cost = (chars: number) => chars + 1; // the name "n" counts too

describe("instructionTier", () => {
  it("tells apart the workspace's, a project's and the person's own", () => {
    expect(instructionTier("org", "all")).toBe("org");
    expect(instructionTier("org", "all_projects")).toBe("org");
    expect(instructionTier("org", "projects")).toBe("project");
    expect(instructionTier("user", "all")).toBe("user");
  });
  it("keeps a personal instruction personal even when it is kept for some projects", () => {
    expect(instructionTier("user", "projects")).toBe("user");
    expect(instructionTier("user", "all_projects")).toBe("user");
  });
});

describe("appliesHere", () => {
  it("applies everywhere, also outside any project", () => {
    expect(appliesHere({ appliesTo: "all", projectIds: [] }, null)).toBe(true);
    expect(appliesHere({ appliesTo: "all", projectIds: [] }, "p1")).toBe(true);
  });
  it("applies in every project, but not outside one", () => {
    expect(appliesHere({ appliesTo: "all_projects", projectIds: [] }, "p1")).toBe(true);
    expect(appliesHere({ appliesTo: "all_projects", projectIds: [] }, null)).toBe(false);
  });
  it("applies only in the projects it lists", () => {
    const it2 = { appliesTo: "projects" as const, projectIds: ["a", "b"] };
    expect(appliesHere(it2, "a")).toBe(true);
    expect(appliesHere(it2, "b")).toBe(true);
    expect(appliesHere(it2, "c")).toBe(false);
    expect(appliesHere(it2, null)).toBe(false);
  });
});

describe("limits", () => {
  it("add up to what the prompt carries", () => {
    expect(MAX_INSTRUCTION_CHARS).toBe(
      INSTRUCTION_LIMIT.org + INSTRUCTION_LIMIT.project + INSTRUCTION_LIMIT.user,
    );
  });
  it("count a name and a text, ignoring stray spaces", () => {
    expect(instructionChars("  Tone \n", "  Be kind.  ")).toBe("Tone".length + "Be kind.".length);
  });
});

describe("worstCaseChars", () => {
  const w = (appliesTo: "all" | "all_projects" | "projects", chars: number, projectIds: string[] = []) => ({
    appliesTo,
    projectIds,
    chars,
  });
  it("is zero for nothing", () => expect(worstCaseChars([])).toBe(0));
  it("adds what applies everywhere to the busiest place, not to all of them", () => {
    expect(
      worstCaseChars([
        w("all", 100),
        w("projects", 50, ["a"]),
        w("projects", 50, ["a"]),
        w("projects", 30, ["b"]),
      ]),
    ).toBe(200);
  });
  it("counts an instruction for several projects once in each of them", () => {
    expect(worstCaseChars([w("projects", 40, ["a", "b"]), w("projects", 30, ["b"])])).toBe(70);
  });
  it("counts 'all projects' in a project but not outside one", () => {
    expect(worstCaseChars([w("all_projects", 60), w("all", 10)])).toBe(70);
    expect(worstCaseChars([w("all_projects", 60)])).toBe(60);
  });
});

describe("instructionUsage", () => {
  it("counts only the same level, and only the same person's personal ones", () => {
    const others = [
      item({ id: "1", chars: 100 }),
      item({ id: "2", chars: 100, ownerId: "someone-else" }),
      item({ id: "3", chars: 100, scope: "org", ownerId: "admin" }),
    ];
    const usage = instructionUsage(others, item({ chars: 10 }));
    expect(usage).toMatchObject({ tier: "user", limit: INSTRUCTION_LIMIT.user });
    expect(usage.used).toBe(cost(100) + cost(10));
  });

  it("leaves out the draft's old self and anything switched off", () => {
    const others = [item({ id: "1", chars: 500 }), item({ id: "2", chars: 500, enabled: false })];
    expect(instructionUsage(others, item({ id: "1", chars: 20 })).used).toBe(cost(20));
  });

  it("counts nothing for a draft that is switched off", () => {
    expect(instructionUsage([], item({ enabled: false, chars: 900 })).used).toBe(0);
  });

  it("measures an instruction for chosen projects against the project room, apart from the workspace's", () => {
    const others = [
      item({ id: "1", scope: "org", ownerId: "admin", chars: 2_900 }),
      item({
        id: "2",
        scope: "org",
        ownerId: "admin",
        appliesTo: "projects",
        projectIds: ["a"],
        chars: 1_000,
      }),
    ];
    const draft = item({
      scope: "org",
      ownerId: "admin",
      appliesTo: "projects",
      projectIds: ["a", "b"],
      chars: 1_000,
    });
    expect(instructionUsage(others, draft)).toEqual({ tier: "project", used: cost(1_000) * 2, limit: 2_500 });
  });

  it("can be over the limit", () => {
    const { used, limit } = instructionUsage([], item({ chars: INSTRUCTION_LIMIT.user + 1 }));
    expect(used).toBeGreaterThan(limit);
  });
});

describe("mayShareWithWorkspace", () => {
  const admin = { userId: "a", role: "org.admin" };
  const member = { userId: "m", role: "org.member" };
  it("lets an admin share anything", () => {
    expect(mayShareWithWorkspace(admin, "all", [])).toBe(true);
    expect(mayShareWithWorkspace(admin, "all_projects", [])).toBe(true);
    expect(mayShareWithWorkspace(admin, "projects", [{ createdBy: "someone" }])).toBe(true);
  });
  it("lets a member share only with projects they created, all of them", () => {
    expect(mayShareWithWorkspace(member, "projects", [{ createdBy: "m" }, { createdBy: "m" }])).toBe(true);
    expect(mayShareWithWorkspace(member, "projects", [{ createdBy: "m" }, { createdBy: "other" }])).toBe(
      false,
    );
    expect(mayShareWithWorkspace(member, "projects", [{ createdBy: null }])).toBe(false);
  });
  it("never lets a member share with every conversation or every project, or with no project", () => {
    expect(mayShareWithWorkspace(member, "all", [])).toBe(false);
    expect(mayShareWithWorkspace(member, "all_projects", [])).toBe(false);
    expect(mayShareWithWorkspace(member, "projects", [])).toBe(false);
  });
});
