import type { CheckResult } from "../core/check.js";
import type { ScanResult } from "../core/scan.js";
import type { TestRun } from "../testing/models.js";
import type { DoctorStatus, EvaluateReport } from "./terminal.js";

export function formatCheckMarkdown(
  reports: (CheckResult | ScanResult)[],
): string {
  const sections: string[] = [];
  for (const report of reports) {
    const isScan = "security" in report && report.security !== undefined;
    const title = isScan
      ? "# SkillGuard Security Scan Report"
      : "# SkillGuard Check Report";
    const lines: string[] = [title, ""];

    lines.push(`- **Tool:** ${report.tool.name} ${report.tool.version}`);
    lines.push(`- **Profile:** \`${report.profile}\``);
    lines.push(`- **Rule Set Version:** \`${report.ruleSetVersion}\``);
    lines.push(
      `- **Status:** ${report.complete ? "Complete" : "Incomplete (limits reached or scan errors)"}`,
    );
    lines.push(`- **Discovered Skills:** ${report.skills.length}`);
    lines.push(`- **Total Findings:** ${report.findings.length}`);
    lines.push(`- **AI Evaluation:** ${report.aiEvaluation}`);
    lines.push("");

    if (report.skills.length > 0) {
      lines.push("## Skills Overview", "");
      lines.push("| Skill Directory | Name | Valid Format |");
      lines.push("| :--- | :--- | :---: |");
      for (const skill of report.skills) {
        lines.push(
          `| \`${skill.path}\` | \`${skill.name ?? "unnamed"}\` | ${skill.valid ? "Yes" : "No"} |`,
        );
      }
      lines.push("");
    }

    if (report.findings.length > 0) {
      lines.push("## Findings", "");
      lines.push("| Severity | Rule ID | Location | Title |");
      lines.push("| :--- | :--- | :--- | :--- |");
      for (const f of report.findings) {
        lines.push(
          `| **${f.severity}** | \`${f.ruleId}\` | \`${f.path}:${f.line}:${f.column}\` | ${f.title} |`,
        );
      }
      lines.push("");

      lines.push("### Finding Details", "");
      for (const f of report.findings) {
        lines.push(
          `#### [${f.severity.toUpperCase()}] ${f.ruleId}: ${f.title}`,
        );
        lines.push(`- **Location:** \`${f.path}:${f.line}:${f.column}\``);
        lines.push(`- **Category:** \`${f.category}\``);
        lines.push(`- **Message:** ${f.message}`);
        lines.push(`- **Remediation:** ${f.remediation}`);
        lines.push("");
      }
    } else {
      lines.push("## Findings", "", "No findings reported.", "");
    }

    if (isScan) {
      const sec = (report as ScanResult).security;
      lines.push("## Security Engine Summary", "");
      lines.push(`- **Files Scanned:** ${sec.filesScanned}`);
      lines.push(`- **Binary Files Skipped:** ${sec.binaryFilesSkipped}`);
      lines.push(`- **Rule Set Version:** \`${sec.ruleSetVersion}\``);
      if (sec.policy.suppressed.length > 0) {
        lines.push(
          `- **Suppressed Findings:** ${sec.policy.suppressed.length}`,
        );
      }
      lines.push("");
    }

    lines.push(
      "> **Notice:** A clean scan does not prove safety. No skill scripts were executed during analysis.",
    );
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n---\n\n");
}

export function formatTestMarkdown(reports: TestRun[]): string {
  const sections: string[] = [];
  for (const report of reports) {
    const lines: string[] = [
      "# SkillGuard Fixture Test Report",
      "",
      `- **Passed:** ${report.passed}`,
      `- **Failed:** ${report.failed}`,
      `- **Total Tests:** ${report.passed + report.failed}`,
      "",
    ];

    if (report.results.length > 0) {
      lines.push("## Test Results", "");
      lines.push("| Status | Test ID | Skill | Failure Details |");
      lines.push("| :---: | :--- | :--- | :--- |");
      for (const res of report.results) {
        const status = res.passed ? "PASS" : "FAIL";
        const failures =
          res.failures.length > 0 ? res.failures.join("; ") : "—";
        lines.push(
          `| **${status}** | \`${res.id}\` | \`${res.skill}\` | ${failures} |`,
        );
      }
      lines.push("");
    }

    lines.push(
      "> **Notice:** Tests evaluate recorded output fixtures only. No live agent or skill scripts were executed.",
    );
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n---\n\n");
}

export function formatDoctorMarkdown(status: DoctorStatus): string {
  return [
    "# SkillGuard Doctor Diagnostic Report",
    "",
    `- **Node.js:** \`${status.node}\``,
    `- **Python Engine Version:** \`${status.engine.version}\``,
    `- **Rule Set Version:** \`${status.engine.ruleSetVersion ?? "unknown"}\``,
    `- **Capabilities:** ${status.engine.capabilities.map((c) => `\`${c}\``).join(", ")}`,
    `- **AI Evaluation:** ${status.aiEvaluation}`,
    `- **Release Ready:** ${status.releaseReady ? "Yes" : "Development only"}`,
    "",
    "> **Notice:** Doctor diagnostics verify local runtime environments without reading skill contents.",
  ].join("\n");
}

export function formatEvaluateMarkdown(reports: EvaluateReport[]): string {
  const sections: string[] = [];
  for (const report of reports) {
    const lines: string[] = [
      "# SkillGuard AI Evaluation Report",
      "",
      `- **Status:** ${report.status}`,
      `- **Target Root:** \`${report.root}\``,
    ];

    if (report.evaluation) {
      const e = report.evaluation;
      lines.push(`- **Provider:** \`${e.provider}\``);
      lines.push(`- **Model:** \`${e.model}\``);
      lines.push(`- **Prompt Version:** \`${e.promptVersion}\``);
      lines.push(`- **Estimated Cost:** $${e.estimatedCostUsd.toFixed(6)} USD`);
      lines.push(`- **Attempts:** ${e.attempts}`);
    }
    if (report.errorCode) {
      lines.push(`- **Error Code:** \`${report.errorCode}\``);
    }
    lines.push(`- **Advisory Findings:** ${report.findings.length}`);
    lines.push("");

    if (report.findings.length > 0) {
      lines.push("## Advisory Findings", "");
      lines.push("| Severity | Rule ID | Location | Title |");
      lines.push("| :--- | :--- | :--- | :--- |");
      for (const f of report.findings) {
        lines.push(
          `| **${f.severity}** | \`${f.ruleId}\` | \`${f.path}:${f.line}:${f.column}\` | ${f.title} |`,
        );
      }
      lines.push("");

      lines.push("### Finding Details", "");
      for (const f of report.findings) {
        lines.push(
          `#### [${f.severity.toUpperCase()}] ${f.ruleId}: ${f.title}`,
        );
        lines.push(`- **Location:** \`${f.path}:${f.line}:${f.column}\``);
        lines.push(`- **Message:** ${f.message}`);
        lines.push(`- **Remediation:** ${f.remediation}`);
        lines.push("");
      }
    } else {
      lines.push(
        "## Advisory Findings",
        "",
        "No advisory concerns identified.",
        "",
      );
    }

    lines.push(`> **Disclaimer:** ${report.disclaimer}`);
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n---\n\n");
}
