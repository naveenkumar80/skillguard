import type { CheckResult } from "../core/check.js";
import type { ScanResult } from "../core/scan.js";
import type { Finding } from "../core/models.js";
import type { EvaluateReport } from "./terminal.js";

export const SARIF_SCHEMA_URI = "https://json.schemastore.org/sarif-2.1.0.json";
export const SARIF_VERSION = "2.1.0";
export const SARIF_INFORMATION_URI =
  "https://github.com/naveenkumar80/skillguard";

export type SarifLevel = "error" | "warning" | "note" | "none";

export function mapSeverityToSarifLevel(severity: string): SarifLevel {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
    case "info":
    default:
      return "note";
  }
}

export interface SarifRuleDescriptor {
  id: string;
  name?: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  help?: { text: string };
  helpUri?: string;
  defaultConfiguration?: { level: SarifLevel };
  properties?: {
    category?: string;
    advisory?: boolean;
    [key: string]: unknown;
  };
}

export interface SarifPhysicalLocation {
  artifactLocation: {
    uri: string;
    uriBaseId?: string;
  };
  region?: {
    startLine: number;
    startColumn?: number;
  };
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations?: { physicalLocation: SarifPhysicalLocation }[];
  properties?: {
    category?: string;
    confidence?: string;
    advisory?: boolean;
    [key: string]: unknown;
  };
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri?: string;
      rules?: SarifRuleDescriptor[];
    };
  };
  results: SarifResult[];
}

export interface SarifDocument {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

export function buildSarifRules(findings: Finding[]): SarifRuleDescriptor[] {
  const rulesMap = new Map<string, SarifRuleDescriptor>();
  for (const finding of findings) {
    if (!rulesMap.has(finding.ruleId)) {
      const helpUri = finding.references?.find(
        (ref) => typeof ref === "string" && /^https?:\/\//i.test(ref),
      );
      rulesMap.set(finding.ruleId, {
        id: finding.ruleId,
        shortDescription: { text: finding.title },
        ...(finding.message
          ? { fullDescription: { text: finding.message } }
          : {}),
        ...(finding.remediation ? { help: { text: finding.remediation } } : {}),
        ...(helpUri ? { helpUri } : {}),
        defaultConfiguration: {
          level: mapSeverityToSarifLevel(finding.severity),
        },
        properties: {
          category: finding.category,
          advisory: finding.category === "ai-evaluation",
        },
      });
    }
  }
  return Array.from(rulesMap.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function buildSarifResults(findings: Finding[]): SarifResult[] {
  const results: SarifResult[] = [];
  for (const finding of findings) {
    const result: SarifResult = {
      ruleId: finding.ruleId,
      level: mapSeverityToSarifLevel(finding.severity),
      message: { text: finding.message || finding.title },
      properties: {
        category: finding.category,
        ...(finding.confidence ? { confidence: finding.confidence } : {}),
        advisory: finding.category === "ai-evaluation",
      },
    };

    if (finding.path && finding.path.trim().length > 0) {
      const physicalLocation: SarifPhysicalLocation = {
        artifactLocation: {
          uri: finding.path,
          uriBaseId: "%SRCROOT%",
        },
      };

      if (
        typeof finding.line === "number" &&
        Number.isInteger(finding.line) &&
        finding.line > 0
      ) {
        physicalLocation.region = {
          startLine: finding.line,
          ...(typeof finding.column === "number" &&
          Number.isInteger(finding.column) &&
          finding.column > 0
            ? { startColumn: finding.column }
            : {}),
        };
      }
      result.locations = [{ physicalLocation }];
    }

    results.push(result);
  }
  return results;
}

export function formatCheckSarif(
  reports: (CheckResult | ScanResult)[],
  toolName = "skillguard",
  toolVersion = "0.1.0",
): string {
  const allFindings: Finding[] = [];
  for (const report of reports) {
    allFindings.push(...report.findings);
  }

  const sarifDoc: SarifDocument = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            informationUri: SARIF_INFORMATION_URI,
            rules: buildSarifRules(allFindings),
          },
        },
        results: buildSarifResults(allFindings),
      },
    ],
  };

  return JSON.stringify(sarifDoc, null, 2);
}

export function formatEvaluateSarif(
  reports: EvaluateReport[],
  toolName = "skillguard",
  toolVersion = "0.1.0",
): string {
  const allFindings: Finding[] = [];
  for (const report of reports) {
    allFindings.push(...report.findings);
  }

  const sarifDoc: SarifDocument = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            informationUri: SARIF_INFORMATION_URI,
            rules: buildSarifRules(allFindings),
          },
        },
        results: buildSarifResults(allFindings),
      },
    ],
  };

  return JSON.stringify(sarifDoc, null, 2);
}
