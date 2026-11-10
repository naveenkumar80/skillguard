import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Config } from "../config/config.js";
import {
  readText,
  ScanError,
  structureFinding,
} from "../discovery/filesystem.js";
import { invokeEngine } from "../engine/client.js";
import type { EngineOptions } from "../engine/client.js";
import { check, sortFindings } from "./check.js";
import type { CheckResult } from "./check.js";
import { allRules } from "./rules.js";
import type { Finding, Severity } from "./models.js";

export interface SecurityPolicy {
  suppressed: { finding: Finding; reasonSha256: string }[];
  severityChanges: {
    ruleId: string;
    path: string;
    from: Severity;
    to: Severity;
  }[];
}
export interface ScanResult extends CheckResult {
  security: {
    status: "completed";
    ruleSetVersion: string;
    filesScanned: number;
    binaryFilesSkipped: number;
    policy: SecurityPolicy;
  };
}
export async function scan(
  root: string,
  config: Config,
  options: EngineOptions = {},
): Promise<ScanResult> {
  if (!config.engine.enabled || !config.checks.security)
    throw new ScanError(
      "INVALID_CONFIG",
      "Scan requires engine.enabled and checks.security; use check for Python-free validation",
    );
  const known = new Set(
    (await allRules())
      .filter((rule) => rule.category === "security")
      .map((rule) => rule.id),
  );
  if (
    [
      ...Object.keys(config.rules),
      ...config.suppressions.map((item) => item.ruleId),
    ].some((id) => !known.has(id))
  )
    throw new ScanError(
      "INVALID_CONFIG",
      "Security policy contains an unknown rule ID; run rules to list supported rules",
    );
  const context = await check(root, config);
  let binaryFilesSkipped = 0;
  let bytes = [...context.contents.values()].reduce(
    (total, value) => total + Buffer.byteLength(value),
    0,
  );
  const directories = context.report.skills.map((skill) =>
    posix.dirname(skill.path),
  );
  for (const file of context.inventory.files) {
    if (
      context.contents.has(file.path) ||
      !directories.some(
        (directory) =>
          directory === "." || file.path.startsWith(`${directory}/`),
      )
    )
      continue;
    if (
      file.size > config.limits.maxFileBytes ||
      bytes + file.size > config.limits.maxTotalBytes
    ) {
      context.report.findings.push(
        structureFinding("SG-STRUCT-003", file.path),
      );
      context.report.complete = false;
      continue;
    }
    // Charge attempted bytes, including binary and unreadable resources, to the I/O budget.
    const allowance = Math.min(
      config.limits.maxFileBytes,
      config.limits.maxTotalBytes - bytes,
    );
    bytes += file.size;
    try {
      const text = await readText(context.inventory.root, file.path, allowance);
      bytes += Buffer.byteLength(text) - file.size;
      context.contents.set(file.path, text);
    } catch (error) {
      bytes += allowance - file.size;
      if (
        error instanceof ScanError &&
        (error.code === "BINARY_FILE" || error.code === "INVALID_ENCODING")
      ) {
        binaryFilesSkipped++;
        continue;
      }
      context.report.findings.push(
        structureFinding("SG-STRUCT-007", file.path),
      );
      context.report.complete = false;
    }
  }
  const response = await invokeEngine(
    {
      protocolVersion: "1.0",
      command: "scan",
      files: [...context.contents].map(([path, content]) => ({
        path,
        content,
      })),
    },
    { ...options, timeoutMs: config.engine.timeoutMs },
  );
  const policy: SecurityPolicy = { suppressed: [], severityChanges: [] };
  for (const original of response.findings) {
    const override = config.rules[original.ruleId];
    const finding = { ...original, severity: override ?? original.severity };
    if (override && override !== original.severity)
      policy.severityChanges.push({
        ruleId: original.ruleId,
        path: original.path,
        from: original.severity,
        to: override,
      });
    const suppression = config.suppressions.find(
      (item) => item.ruleId === finding.ruleId && item.path === finding.path,
    );
    if (suppression)
      policy.suppressed.push({
        finding,
        reasonSha256: createHash("sha256")
          .update(suppression.reason)
          .digest("hex"),
      });
    else context.report.findings.push(finding);
  }
  sortFindings(context.report.findings);
  return {
    ...context.report,
    security: {
      status: "completed",
      ruleSetVersion: response.engine.ruleSetVersion ?? "unknown",
      filesScanned: context.contents.size,
      binaryFilesSkipped,
      policy,
    },
  };
}
