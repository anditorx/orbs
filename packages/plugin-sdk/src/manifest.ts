import { z } from "zod";

/**
 * Orbs plugin manifest (`plugin.json`), draft v0.
 * A plugin bundles agents, skills (SKILL.md), workflows, MCP connectors and hooks.
 * Skills follow the open Agent Skills layout so existing skills can be reused.
 */
export const PluginManifest = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase letters, digits and dashes"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "semver, e.g. 1.0.0"),
  displayName: z.string().min(1),
  description: z.string().min(1),
  author: z.object({ name: z.string(), email: z.string().email().optional() }).optional(),
  /** Capabilities shown to the admin in plain language before the plugin is published. */
  permissions: z
    .object({
      connectors: z.array(z.string()).default([]),
      shell: z.boolean().default(false),
      network: z.boolean().default(false),
    })
    .default({ connectors: [], shell: false, network: false }),
  agents: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  workflows: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifest>;

export function parseManifest(input: unknown) {
  return PluginManifest.safeParse(input);
}
