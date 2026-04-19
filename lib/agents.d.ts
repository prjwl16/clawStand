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

export function productInspector(html: string, url: string): Promise<Record<string, ScoreCell>>;
export function repoAuditor(repoUrl: string | null | undefined): Promise<Record<string, ScoreCell>>;
export function pitchWriter(
  scores: Record<string, ScoreCell>,
  total: number,
  maxTotal: number
): Promise<{ verdict: "NOMINATE" | "CUT"; pitch: string; reasoning: string }>;
