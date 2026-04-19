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

export interface PlannedAgent {
  name: "productInspector" | "repoAuditor";
  focusInstructions: string;
}

export interface Plan {
  agents: PlannedAgent[];
  skipReasons?: Array<{ agent: string; reason: string }>;
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

export function repoAuditor(
  repoUrl: string | null | undefined,
  focusInstructions?: string
): Promise<Record<string, ScoreCell>>;

export function pitchWriter(
  scores: Record<string, ScoreCell>,
  total: number,
  maxTotal: number
): Promise<{ verdict: "NOMINATE" | "CUT"; pitch: string; reasoning: string }>;
