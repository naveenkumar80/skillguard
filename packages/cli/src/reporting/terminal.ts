import type { CheckResult } from "../core/check.js";
import type { ScanResult } from "../core/scan.js";
import type { TestRun } from "../testing/models.js";
import type { Finding } from "../core/models.js";

export interface TerminalOptions {
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
}

export interface DoctorStatus {
  node: string;
  engine: {
    version: string;
    ruleSetVersion?: string | null | undefined;
    capabilities: string[];
  };
  aiEvaluation: string;
  releaseReady: boolean;
}

export interface EvaluateReport {
  schemaVersion: "1.0";
  tool: { name: string; version: string };
  status: "completed" | "disabled" | "failed";
  root: string;
  skills: { path: string; name: string | null; valid: boolean }[];
  findings: Finding[];
  evaluation?:
    | {
        provider: string;
        model: string;
        promptVersion: string;
        advisory: boolean;
        estimatedCostUsd: number;
        attempts: number;
      }
    | undefined;
  errorCode?: string | undefined;
  disclaimer: string;
}

export function formatFindingsTerminal(
  findings: Finding[],
  verbose = false,
): string[] {
  const lines: string[] = [];
  for (const finding of findings) {
    lines.push(
      `${finding.path}:${finding.line}:${finding.column} ${finding.severity} ${finding.ruleId} ${finding.title}`,
    );
    if (verbose) {
      if (finding.message) lines.push(`    Message:     ${finding.message}`);
      if (finding.remediation)
        lines.push(`    Remediation: ${finding.remediation}`);
    }
  }
  return lines;
}

export function formatCheckTerminal(
  reports: (CheckResult | ScanResult)[],
  options: TerminalOptions = {},
): string {
  if (options.quiet) return "";
  const lines: string[] = [];
  for (const report of reports) {
    const validCount = report.skills.filter((skill) => skill.valid).length;
    lines.push(
      `Skills: ${report.skills.length}; valid: ${validCount}; incomplete: ${!report.complete}`,
    );
    lines.push(...formatFindingsTerminal(report.findings, options.verbose));
    if ("security" in report && report.security) {
      lines.push(
        `Files scanned: ${report.security.filesScanned}; binary skipped: ${report.security.binaryFilesSkipped}. No skill scripts executed. A clean scan does not prove safety.`,
      );
    } else {
      lines.push(
        "AI: disabled. No skill scripts executed. A clean check does not prove safety.",
      );
    }
  }
  return lines.join("\n");
}

export function formatTestTerminal(
  reports: TestRun[],
  options: TerminalOptions = {},
): string {
  if (options.quiet) return "";
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(
      `Recorded fixture tests: ${report.passed} passed, ${report.failed} failed`,
    );
    for (const test of report.results) {
      if (!test.passed) {
        lines.push(`${test.id}: ${test.failures.join("; ")}`);
      } else if (options.verbose) {
        lines.push(`${test.id}: passed`);
      }
    }
    lines.push("Recorded outputs only; no claim about live agent behavior.");
  }
  return lines.join("\n");
}

export function formatDoctorTerminal(
  status: DoctorStatus,
  options: TerminalOptions = {},
): string {
  if (options.quiet) return "";
  const lines: string[] = [
    `skillguard 0.1.0 (development only)`,
    `Node ${status.node}; Python engine ${status.engine.version}`,
    `Capabilities: ${status.engine.capabilities.join(", ")}`,
  ];
  if (options.verbose && status.engine.ruleSetVersion) {
    lines.push(`Rule set version: ${status.engine.ruleSetVersion}`);
  }
  lines.push(
    `AI evaluation: ${status.aiEvaluation}. A clean scan would not prove safety.`,
  );
  return lines.join("\n");
}

export function formatEvaluateTerminal(
  reports: EvaluateReport[],
  options: TerminalOptions = {},
): string {
  if (options.quiet) return "";
  const lines: string[] = [];
  for (const report of reports) {
    if (report.status === "completed" && report.evaluation) {
      const meta = report.evaluation;
      lines.push(
        `AI evaluation: completed; ${report.findings.length} advisory findings.`,
      );
      lines.push(
        `Provider: ${meta.provider}; Model: ${meta.model}; Estimated cost: $${meta.estimatedCostUsd.toFixed(6)}; Attempts: ${meta.attempts}`,
      );
      lines.push(...formatFindingsTerminal(report.findings, options.verbose));
    } else if (report.status === "disabled") {
      lines.push("AI evaluation: disabled in configuration.");
    } else {
      lines.push(
        `AI evaluation failed: ${report.errorCode ?? "UNKNOWN_ERROR"}. No static findings altered.`,
      );
    }
    lines.push(report.disclaimer);
  }
  return lines.join("\n");
}
