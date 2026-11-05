/**
 * Orbs runner (skeleton).
 *
 * The runner executes agent turns outside the API process so they can be scaled
 * horizontally and isolated in sandboxes. Planned responsibilities:
 *   - claim queued turns (pg-boss) for an organization
 *   - run Orbs' built-in agent loop or an external agent through a harness adapter
 *   - enforce runtime policy (approvals, workspace boundary, data classification)
 *   - append canonical events (turn.*, item.*, approval.*) back to the event log
 *
 * Phase 0 only defines the adapter interface so later phases share one contract.
 */
import type { Engine, OrbsEvent } from "@orbs/protocol";

export interface TurnRequest {
  orgId: string;
  threadId: string;
  engine: Engine;
  text: string;
}

/** Common surface for Orbs' own agent and external agents (Claude Code, Codex, ...). */
export interface HarnessAdapter {
  readonly id: string;
  startTurn(
    request: TurnRequest,
    emit: (event: Omit<OrbsEvent, "seq" | "id" | "occurredAt">) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  steer?(threadId: string, text: string): Promise<void>;
  interrupt(threadId: string): Promise<void>;
}

console.log("orbs-runner: skeleton only (agent execution arrives in Phase 1).");
