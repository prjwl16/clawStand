// Display metadata for the rubric table. Kept separate from lib/agents.js
// so we don't touch the scoring logic.
export const RUBRIC_ORDER = [
  "realOutputShipping",
  "taskDecompositionQuality",
  "observability",
  "evaluationAndIterationTooling",
  "agentHandoffsAndMemory",
  "costAndLatencyOnJudgeTask",
  "managementUIUsability",
] as const;

export const RUBRIC_LABELS: Record<string, { title: string; sub: string; weight: number; root?: boolean }> = {
  realOutputShipping: {
    title: "Real output shipping",
    sub: "Does a user get value? The root.",
    weight: 20,
    root: true,
  },
  taskDecompositionQuality: {
    title: "Task decomposition",
    sub: "Clear phases, defined contracts.",
    weight: 5,
  },
  observability: {
    title: "Observability",
    sub: "Traces, logs, reconstructable runs.",
    weight: 7,
  },
  evaluationAndIterationTooling: {
    title: "Evals & iteration",
    sub: "Can you tell if a change helped?",
    weight: 5,
  },
  agentHandoffsAndMemory: {
    title: "Handoffs & memory",
    sub: "Typed contracts, durable state.",
    weight: 2,
  },
  costAndLatencyOnJudgeTask: {
    title: "Cost & latency",
    sub: "Per-task wall time and spend.",
    weight: 1,
  },
  managementUIUsability: {
    title: "Management UI",
    sub: "Would a non-dev use it?",
    weight: 1,
  },
};

export function levelNumber(level: string | undefined): number {
  if (!level) return 1;
  const n = parseInt(String(level).replace(/[^0-9]/g, ""), 10);
  return n >= 1 && n <= 5 ? n : 1;
}
