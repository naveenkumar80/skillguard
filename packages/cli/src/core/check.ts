import { basename, dirname } from "node:path";
import type { Config } from "../config/config.js";
import {
  inventory,
  readText,
  structureFinding,
} from "../discovery/filesystem.js";
import type { Inventory } from "../discovery/filesystem.js";
import { validateFormat } from "../validators/format.js";
import { validateReferences } from "../validators/references.js";
import type { Finding } from "./models.js";
import { identity } from "./identity.js";

export interface SkillResult {
  path: string;
  name: string | null;
  valid: boolean;
}
export interface CheckResult {
  schemaVersion: "1.0";
  tool: { name: string; version: string };
  ruleSetVersion: string;
  profile: string;
  complete: boolean;
  skills: SkillResult[];
  findings: Finding[];
  aiEvaluation: "disabled";
}
export interface CheckContext {
  report: CheckResult;
  inventory: Inventory;
  contents: Map<string, string>;
}
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) =>
    a.path < b.path
      ? -1
      : a.path > b.path
        ? 1
        : a.line - b.line ||
          a.column - b.column ||
          (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
  );
}
export async function check(
  root: string,
  config: Config,
): Promise<CheckContext> {
  const files = await inventory(root, config.exclude, config.limits);
  const report: CheckResult = {
    schemaVersion: "1.0",
    tool: { name: identity.name, version: identity.version },
    ruleSetVersion: "1.0.0",
    profile: config.profile,
    complete: files.complete,
    skills: [],
    findings: [...files.findings],
    aiEvaluation: "disabled",
  };
  const contents = new Map<string, string>();
  const names = new Map<string, string>();
  let totalBytes = 0;
  let loadedBytes = 0;
  for (const file of files.files.filter(
    (entry) => basename(entry.path) === "SKILL.md",
  )) {
    if (
      file.size > config.limits.maxFileBytes ||
      totalBytes + file.size > config.limits.maxTotalBytes
    ) {
      report.findings.push(structureFinding("SG-STRUCT-003", file.path));
      report.complete = false;
      report.skills.push({ path: file.path, name: null, valid: false });
      continue;
    }
    totalBytes += file.size;
    try {
      const content = await readText(
        files.root,
        file.path,
        config.limits.maxFileBytes,
      );
      // Recheck actual bytes as files may have changed since inventory.
      if (
        loadedBytes + Buffer.byteLength(content) >
        config.limits.maxTotalBytes
      ) {
        report.findings.push(structureFinding("SG-STRUCT-003", file.path));
        report.complete = false;
        report.skills.push({ path: file.path, name: null, valid: false });
        continue;
      }
      loadedBytes += Buffer.byteLength(content);
      contents.set(file.path, content);
      const directory =
        dirname(file.path) === "."
          ? basename(files.root)
          : basename(dirname(file.path));
      const format = validateFormat(
        content,
        file.path,
        directory,
        config.checks.quality,
      );
      const findings = format.findings.filter((finding) =>
        finding.category === "quality"
          ? config.checks.quality
          : finding.category === "structure" || config.checks.spec,
      );
      if (format.name && names.has(format.name)) {
        findings.push(structureFinding("SG-STRUCT-005", file.path));
        const earlierPath = names.get(format.name);
        const earlier = report.skills.find(
          (skill) => skill.path === earlierPath,
        );
        if (earlier) earlier.valid = false;
      } else if (format.name) names.set(format.name, file.path);
      report.findings.push(...findings);
      report.skills.push({
        path: file.path,
        name: format.name,
        valid: !findings.some((finding) => finding.category !== "quality"),
      });
    } catch {
      report.findings.push(structureFinding("SG-STRUCT-007", file.path));
      report.complete = false;
      report.skills.push({ path: file.path, name: null, valid: false });
    }
  }
  const context = { report, inventory: files, contents };
  if (config.checks.structure) {
    const references = await validateReferences(context, config);
    report.findings.push(...references);
    if (
      references.some((finding) =>
        ["SG-REF-003", "SG-REF-004", "SG-REF-005"].includes(finding.ruleId),
      )
    )
      report.complete = false;
    for (const skill of report.skills) {
      const directory = dirname(skill.path).split("\\\\").join("/");
      if (
        references.some(
          (finding) =>
            finding.category !== "quality" &&
            (directory === "." || finding.path.startsWith(`${directory}/`)),
        )
      )
        skill.valid = false;
    }
  }
  sortFindings(report.findings);
  return context;
}
