export type LevelKey = "L1" | "L2" | "L3" | "L4" | "L5";

export interface ScoreCell {
  level: LevelKey | string;
  evidence: string;
}

export interface RubricEntry {
  weight: number;
  maxPoints: number;
  root?: boolean;
  descriptors: Record<LevelKey, string>;
}

export const RUBRIC: Record<string, RubricEntry>;
export const RUBRIC_VIRALITY: Record<string, RubricEntry>;
export const RUBRIC_REVENUE: Record<string, RubricEntry>;

export interface ViralityStats {
  impressions?: number;
  reactions?: number;
  visitors?: number;
  signups?: number;
  amplification?: string;
}

export interface RevenueStats {
  signups?: number;
  revenueUSD?: number;
  waitlist?: number;
}

export function viralityJudge(input: {
  url: string;
  html: string;
  stats?: ViralityStats;
  repoUrl?: string | null;
}): Promise<Record<string, ScoreCell>>;

export function revenueJudge(input: {
  url: string;
  html: string;
  stats?: RevenueStats;
  repoUrl?: string | null;
}): Promise<Record<string, ScoreCell>>;

export interface PlannedAgent {
  name: "productInspector" | "repoAuditor";
  run: boolean;
  focusInstructions: string;
  skipReason?: string;
}

export interface Plan {
  reasoning: string;
  agents: PlannedAgent[];
}

export function planExecution(
  url: string,
  repoUrl: string | null | undefined
): Promise<Plan>;

export function productInspector(
  html: string,
  url: string,
  focusInstructions?: string
): Promise<Record<string, ScoreCell>>;

export function renderedInspector(
  url: string,
  focusInstructions?: string
): Promise<Record<string, ScoreCell> | null>;

export function readmeInspector(
  repoUrl: string | null | undefined,
  productUrl: string,
  focusInstructions?: string
): Promise<Record<string, ScoreCell> | null>;

export function fetchRenderedMarkdown(url: string): Promise<string | null>;

export function fetchRepoReadme(
  repoUrl: string | null | undefined
): Promise<string | null>;

export function mergeProductScores(
  views: Array<{ source: string; scores: Record<string, ScoreCell> | null }>
): Record<string, ScoreCell>;

export function repoAuditor(
  repoUrl: string | null | undefined,
  focusInstructions?: string
): Promise<Record<string, ScoreCell>>;

export function pitchWriter(
  scores: Record<string, ScoreCell>,
  total: number,
  maxTotal: number,
  opts?: {
    trackName?: string;
    rubric?: Record<string, RubricEntry>;
    rootKey?: string;
    nomThreshold?: number;
  }
): Promise<{ verdict: "NOMINATE" | "CUT"; pitch: string; reasoning: string }>;
