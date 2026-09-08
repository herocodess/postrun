import type { Step, Turn } from "../schema/index.js";

/**
 * Group steps into turns by turn_id, in order of first appearance.
 * Used for adapters that emit steps only (Claude Code). Cline emits Turn[] itself.
 */
export function turnsFromSteps(steps: Step[], sessionId: string): Turn[] {
  const turns: Turn[] = [];
  const byId = new Map<string, Turn>();
  for (const s of steps) {
    let t = byId.get(s.turn_id);
    if (!t) {
      t = {
        id: s.turn_id,
        session_id: sessionId,
        segment_index: s.segment_index,
        actor_id: s.actor_id,
        index: turns.length + 1,
        started_at: s.at,
        step_ids: [],
      };
      if (s.turn_id.startsWith("turn:") && s.turn_id !== "turn:unknown") t.prompt_id = s.turn_id.slice("turn:".length);
      byId.set(s.turn_id, t);
      turns.push(t);
    }
    t.step_ids.push(s.id);
  }
  return turns;
}
