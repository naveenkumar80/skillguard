export const severities = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type Severity = (typeof severities)[number];
export type Confidence = "low" | "medium" | "high";
export type Category =
  | "spec"
  | "structure"
  | "quality"
  | "security"
  | "test"
  | "ai-evaluation";

export interface Finding {
  schemaVersion: "1.0";
  ruleId: string;
  title: string;
  category: Category;
  severity: Severity;
  confidence: Confidence;
  path: string;
  line: number;
  column: number;
  message: string;
  evidence: { redacted: true; excerpt: string };
  remediation: string;
  references: string[];
}

export interface RuleMetadata {
  id: string;
  version: string;
  title: string;
  category: Category;
  defaultSeverity: Severity;
  confidence: Confidence;
  description: string;
  remediation: string;
  references: string[];
}

export interface EvaluationSettings {
  enabled: true;
  consent: true;
  provider: "openai";
  model: string;
  maxCostUsd: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  maxOutputTokens: number;
  maxInputBytes: number;
  timeoutMs: number;
  maxRetries: number;
}
export interface EvaluationMetadata {
  provider: "openai";
  model: string;
  promptVersion: "1.0.0";
  advisory: true;
  estimatedCostUsd: number;
  attempts: number;
}
export type EngineRequest = {
  protocolVersion: "1.0";
  files: { path: string; content: string }[];
} & (
  | { command: "doctor" | "scan"; evaluation?: never }
  | { command: "evaluate"; evaluation: EvaluationSettings }
);
export interface EngineInfo {
  version: string;
  capabilities: ("doctor" | "scan" | "evaluate")[];
  ruleSetVersion: string | null;
}
export type EngineResponse =
  | {
      protocolVersion: "1.0";
      ok: true;
      findings: Finding[];
      engine: EngineInfo;
      evaluation?: EvaluationMetadata;
    }
  | {
      protocolVersion: "1.0";
      ok: false;
      findings: [];
      error: { code: string; message: string; retryable: boolean };
    };

export function crossesThreshold(
  findings: readonly Finding[],
  threshold: Severity,
  strict = false,
): boolean {
  return findings.some(
    (finding) =>
      finding.category !== "ai-evaluation" &&
      severities.indexOf(finding.severity) >=
        severities.indexOf(strict ? "info" : threshold),
  );
}
