// Display metadata for the rubric table. Kept separate from lib/agents.js
// so we don't touch the scoring logic.

// ------------------------------------------------------------------
// MaaS track (existing — unchanged).
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// Multi-track metadata (Virality + Revenue added).
// ------------------------------------------------------------------
export type TrackId = "maas" | "virality" | "revenue";

export type RubricLabel = {
  title: string;
  sub: string;
  weight: number;
  root?: boolean;
};

export type TrackMeta = {
  id: TrackId;
  label: string;
  tag: string;              // one-word pitch (e.g. "Agents as employees")
  order: string[];
  labels: Record<string, RubricLabel>;
  maxTotal: number;
};

export const TRACK_META: Record<TrackId, TrackMeta> = {
  maas: {
    id: "maas",
    label: "MaaS",
    tag: "Agents as employees",
    order: [...RUBRIC_ORDER],
    labels: RUBRIC_LABELS,
    maxTotal: 164,
  },
  virality: {
    id: "virality",
    label: "Virality",
    tag: "Build-in-public, narrative + distribution",
    order: [
      "signupsOrMeaningfulActions",
      "visitorsToProduct",
      "amplificationQuality",
      "reactionsAndComments",
      "impressionsAndViews",
    ],
    labels: {
      signupsOrMeaningfulActions: {
        title: "Signups / meaningful actions",
        sub: "The root — real first-use events.",
        weight: 25,
        root: true,
      },
      visitorsToProduct: {
        title: "Visitors to product",
        sub: "Unique uniques. Datafast, PH, GA4.",
        weight: 10,
      },
      amplificationQuality: {
        title: "Amplification quality",
        sub: "Whose accounts reshared — not volume.",
        weight: 3,
      },
      reactionsAndComments: {
        title: "Reactions & comments",
        sub: "Organic + (ad × 0.25), all platforms.",
        weight: 2,
      },
      impressionsAndViews: {
        title: "Impressions & views",
        sub: "Organic + (ad × 0.25), aggregated.",
        weight: 1,
      },
    },
    maxTotal: 164,
  },
  revenue: {
    id: "revenue",
    label: "Revenue",
    tag: "Seed-stage lens, real money moved",
    order: [
      "signups",
      "liveProductQuality",
      "revenueGenerated",
      "waitlist",
      "painPointSeverity",
      "som",
      "rightToWin",
      "whyNow",
      "moatAndDefensibility",
    ],
    labels: {
      signups: {
        title: "Signups",
        sub: "Root — email + first-use event.",
        weight: 20,
        root: true,
      },
      liveProductQuality: {
        title: "Live product quality",
        sub: "Time to first value, UX craft.",
        weight: 8,
      },
      revenueGenerated: {
        title: "Revenue generated (USD)",
        sub: "Real money moved during event.",
        weight: 4,
      },
      waitlist: {
        title: "Waitlist",
        sub: "Emails without product touch.",
        weight: 4,
      },
      painPointSeverity: {
        title: "Pain point severity",
        sub: "Named user, conversations, willingness to pay.",
        weight: 2,
      },
      som: {
        title: "SOM (bottoms-up math)",
        sub: "Users × realistic ACV, show the math.",
        weight: 2,
      },
      rightToWin: {
        title: "Right to win",
        sub: "Founder-market fit + insight.",
        weight: 2,
      },
      whyNow: {
        title: "Why now",
        sub: "Specific recent unlock, not 'AI is hot'.",
        weight: 1,
      },
      moatAndDefensibility: {
        title: "Moat & defensibility",
        sub: "Not copyable in a weekend.",
        weight: 1,
      },
    },
    maxTotal: 176,
  },
};

export function getTrackMeta(track: string | undefined | null): TrackMeta {
  if (track === "virality") return TRACK_META.virality;
  if (track === "revenue") return TRACK_META.revenue;
  return TRACK_META.maas;
}
