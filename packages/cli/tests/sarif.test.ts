import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import {
  buildSarifResults,
  buildSarifRules,
  formatCheckSarif,
  formatEvaluateSarif,
  mapSeverityToSarifLevel,
  SARIF_INFORMATION_URI,
  SARIF_SCHEMA_URI,
  SARIF_VERSION,
} from "../src/reporting/sarif.js";
import type { Finding } from "../src/core/models.js";
import type { CheckResult } from "../src/core/check.js";
import type { ScanResult } from "../src/core/scan.js";
import type { EvaluateReport } from "../src/reporting/terminal.js";

const sarifMetaSchema = {
  type: "object",
  required: ["$schema", "version", "runs"],
  additionalProperties: true,
  properties: {
    $schema: { type: "string", const: SARIF_SCHEMA_URI },
    version: { type: "string", const: SARIF_VERSION },
    runs: {
      type: "array",
      items: {
        type: "object",
        required: ["tool", "results"],
        additionalProperties: true,
        properties: {
          tool: {
            type: "object",
            required: ["driver"],
            additionalProperties: true,
            properties: {
              driver: {
                type: "object",
                required: ["name", "version", "rules"],
                additionalProperties: true,
                properties: {
                  name: { type: "string" },
                  version: { type: "string" },
                  informationUri: { type: "string" },
                  rules: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["id", "shortDescription"],
                      additionalProperties: true,
                      properties: {
                        id: { type: "string" },
                        shortDescription: {
                          type: "object",
                          required: ["text"],
                          properties: { text: { type: "string" } },
                        },
                        fullDescription: {
                          type: "object",
                          required: ["text"],
                          properties: { text: { type: "string" } },
                        },
                        help: {
                          type: "object",
                          required: ["text"],
                          properties: { text: { type: "string" } },
                        },
                        helpUri: { type: "string" },
                        defaultConfiguration: {
                          type: "object",
                          required: ["level"],
                          properties: {
                            level: {
                              type: "string",
                              enum: ["error", "warning", "note", "none"],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          results: {
            type: "array",
            items: {
              type: "object",
              required: ["ruleId", "level", "message"],
              additionalProperties: true,
              properties: {
                ruleId: { type: "string" },
                level: {
                  type: "string",
                  enum: ["error", "warning", "note", "none"],
                },
                message: {
                  type: "object",
                  required: ["text"],
                  properties: { text: { type: "string" } },
                },
                locations: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["physicalLocation"],
                    additionalProperties: true,
                    properties: {
                      physicalLocation: {
                        type: "object",
                        required: ["artifactLocation"],
                        additionalProperties: true,
                        properties: {
                          artifactLocation: {
                            type: "object",
                            required: ["uri"],
                            properties: {
                              uri: { type: "string" },
                              uriBaseId: { type: "string" },
                            },
                          },
                          region: {
                            type: "object",
                            required: ["startLine"],
                            properties: {
                              startLine: { type: "integer", minimum: 1 },
                              startColumn: { type: "integer", minimum: 1 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                properties: {
                  type: "object",
                  properties: {
                    category: { type: "string" },
                    advisory: { type: "boolean" },
                    confidence: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateSarif = ajv.compile(sarifMetaSchema);

describe("SARIF 2.1.0 Severity Mapping", () => {
  it("maps critical and high severities to error", () => {
    expect(mapSeverityToSarifLevel("critical")).toBe("error");
    expect(mapSeverityToSarifLevel("high")).toBe("error");
  });

  it("maps medium severity to warning", () => {
    expect(mapSeverityToSarifLevel("medium")).toBe("warning");
  });

  it("maps low and info severities to note", () => {
    expect(mapSeverityToSarifLevel("low")).toBe("note");
    expect(mapSeverityToSarifLevel("info")).toBe("note");
  });

  it("defaults unknown severities to note", () => {
    expect(mapSeverityToSarifLevel("unknown")).toBe("note");
  });
});

describe("SARIF Rule and Result Builders", () => {
  const sampleDeterministicFinding: Finding = {
    schemaVersion: "1.0",
    ruleId: "SG-SEC-001",
    title: "Plaintext API secret candidate",
    category: "security",
    severity: "high",
    confidence: "high",
    path: "SKILL.md",
    line: 12,
    column: 3,
    message: "A potential plaintext secret was found in file content.",
    evidence: { redacted: true, excerpt: "[REDACTED]" },
    remediation: "Remove the secret and reference an environment variable.",
    references: ["https://example.com/security"],
  };

  const sampleAdvisoryFinding: Finding = {
    schemaVersion: "1.0",
    ruleId: "SG-AI-001",
    title: "Advisory instruction clarity concern",
    category: "ai-evaluation",
    severity: "medium",
    confidence: "medium",
    path: "SKILL.md",
    line: 5,
    column: 1,
    message: "AI assessment suggests clearer phrasing for these steps.",
    evidence: { redacted: true, excerpt: "[REDACTED]" },
    remediation: "Review step clarity and prerequisites.",
    references: [],
  };

  const sampleFindingWithoutLocation: Finding = {
    schemaVersion: "1.0",
    ruleId: "SG-STRUCT-003",
    title: "Resource directory size exceeded",
    category: "structure",
    severity: "low",
    confidence: "high",
    path: "",
    line: 0,
    column: 0,
    message: "The skill directory exceeds maximum allowed file count.",
    evidence: { redacted: true, excerpt: "[REDACTED]" },
    remediation: "Remove excess resources.",
    references: [],
  };

  it("builds unique rule descriptors with proper descriptions and advisory tags", () => {
    const rules = buildSarifRules([
      sampleDeterministicFinding,
      sampleAdvisoryFinding,
      sampleDeterministicFinding, // duplicate ruleId
    ]);

    expect(rules).toHaveLength(2);
    const secRule = rules.find((r) => r.id === "SG-SEC-001")!;
    expect(secRule.shortDescription.text).toBe(
      "Plaintext API secret candidate",
    );
    expect(secRule.fullDescription?.text).toBe(
      "A potential plaintext secret was found in file content.",
    );
    expect(secRule.help?.text).toBe(
      "Remove the secret and reference an environment variable.",
    );
    expect(secRule.helpUri).toBe("https://example.com/security");
    expect(secRule.defaultConfiguration?.level).toBe("error");
    expect(secRule.properties?.category).toBe("security");
    expect(secRule.properties?.advisory).toBe(false);

    const aiRule = rules.find((r) => r.id === "SG-AI-001")!;
    expect(aiRule.helpUri).toBeUndefined();
    expect(aiRule.defaultConfiguration?.level).toBe("warning");
    expect(aiRule.properties?.category).toBe("ai-evaluation");
    expect(aiRule.properties?.advisory).toBe(true);
  });

  it("builds SARIF results with physical locations when path and line numbers exist", () => {
    const results = buildSarifResults([sampleDeterministicFinding]);
    expect(results).toHaveLength(1);
    const res = results[0]!;
    expect(res.ruleId).toBe("SG-SEC-001");
    expect(res.level).toBe("error");
    expect(res.locations).toBeDefined();
    expect(res.locations![0]!.physicalLocation.artifactLocation.uri).toBe(
      "SKILL.md",
    );
    expect(res.locations![0]!.physicalLocation.region).toEqual({
      startLine: 12,
      startColumn: 3,
    });
    expect(res.properties?.advisory).toBe(false);
  });

  it("omits region when line is 0 or undefined, and omits locations when path is empty", () => {
    const results = buildSarifResults([sampleFindingWithoutLocation]);
    expect(results).toHaveLength(1);
    const res = results[0]!;
    expect(res.ruleId).toBe("SG-STRUCT-003");
    expect(res.level).toBe("note");
    expect(res.locations).toBeUndefined();
  });

  it("handles empty findings list producing valid empty runs", () => {
    const rules = buildSarifRules([]);
    const results = buildSarifResults([]);
    expect(rules).toEqual([]);
    expect(results).toEqual([]);
  });
});

describe("SARIF Document Formatter and Schema Validation", () => {
  const sampleScanReport: ScanResult = {
    schemaVersion: "1.0",
    tool: { name: "skillguard", version: "0.1.0" },
    ruleSetVersion: "1.0.0",
    profile: "agent-skills-current",
    complete: true,
    skills: [{ path: "SKILL.md", name: "greeting", valid: true }],
    findings: [
      {
        schemaVersion: "1.0",
        ruleId: "SG-SEC-001",
        title: "Plaintext API secret candidate",
        category: "security",
        severity: "critical",
        confidence: "high",
        path: "SKILL.md",
        line: 8,
        column: 1,
        message: "Secret detected.",
        evidence: { redacted: true, excerpt: "[REDACTED]" },
        remediation: "Remove secret.",
        references: [],
      },
      {
        schemaVersion: "1.0",
        ruleId: "SG-AI-001",
        title: "Advisory clarity concern",
        category: "ai-evaluation",
        severity: "low",
        confidence: "low",
        path: "SKILL.md",
        line: 1,
        column: 1,
        message: "Improve clarity.",
        evidence: { redacted: true, excerpt: "[REDACTED]" },
        remediation: "Clarify wording.",
        references: [],
      },
    ],
    aiEvaluation: "disabled",
    security: {
      status: "completed",
      ruleSetVersion: "1.0.0",
      filesScanned: 2,
      binaryFilesSkipped: 0,
      policy: { suppressed: [], severityChanges: [] },
    },
  };

  it("formats check and scan reports as valid SARIF 2.1.0 JSON matching the schema", () => {
    const raw = formatCheckSarif([sampleScanReport]);
    const parsed = JSON.parse(raw);

    const valid = validateSarif(parsed);
    expect(valid, JSON.stringify(validateSarif.errors)).toBe(true);

    expect(parsed.$schema).toBe(SARIF_SCHEMA_URI);
    expect(parsed.version).toBe(SARIF_VERSION);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].tool.driver.name).toBe("skillguard");
    expect(parsed.runs[0].tool.driver.version).toBe("0.1.0");
    expect(parsed.runs[0].tool.driver.informationUri).toBe(
      SARIF_INFORMATION_URI,
    );
    expect(parsed.runs[0].tool.driver.informationUri).toBe(
      "https://github.com/naveenkumar80/skillguard",
    );
    expect(raw).not.toContain("https://github.com/skillguard/skillguard");
    expect(parsed.runs[0].results).toHaveLength(2);
    expect(parsed.runs[0].results[0].level).toBe("error");
    expect(parsed.runs[0].results[1].level).toBe("note");
  });

  it("formats evaluate reports as valid SARIF 2.1.0 JSON matching the schema", () => {
    const sampleEvalReport: EvaluateReport = {
      schemaVersion: "1.0",
      tool: { name: "skillguard", version: "0.1.0" },
      status: "completed",
      root: "/path/to/skill",
      skills: [{ path: "SKILL.md", name: "greeting", valid: true }],
      findings: [
        {
          schemaVersion: "1.0",
          ruleId: "SG-AI-002",
          title: "Advisory instruction safety concern",
          category: "ai-evaluation",
          severity: "high",
          confidence: "medium",
          path: "SKILL.md",
          line: 15,
          column: 1,
          message: "Potential unsafe instructions detected.",
          evidence: { redacted: true, excerpt: "[REDACTED]" },
          remediation: "Review instructions.",
          references: [],
        },
      ],
      evaluation: {
        provider: "openai",
        model: "gpt-4o-mini",
        promptVersion: "1.0.0",
        advisory: true,
        estimatedCostUsd: 0.00045,
        attempts: 1,
      },
      disclaimer: "AI findings are advisory only.",
    };

    const raw = formatEvaluateSarif([sampleEvalReport]);
    const parsed = JSON.parse(raw);

    const valid = validateSarif(parsed);
    expect(valid, JSON.stringify(validateSarif.errors)).toBe(true);

    expect(parsed.runs[0].tool.driver.informationUri).toBe(
      SARIF_INFORMATION_URI,
    );
    expect(parsed.runs[0].results[0].ruleId).toBe("SG-AI-002");
    expect(parsed.runs[0].results[0].level).toBe("error");
    expect(parsed.runs[0].results[0].properties.advisory).toBe(true);
  });

  it("handles empty scan reports yielding valid schema-conformant SARIF", () => {
    const emptyReport: CheckResult = {
      schemaVersion: "1.0",
      tool: { name: "skillguard", version: "0.1.0" },
      ruleSetVersion: "1.0.0",
      profile: "agent-skills-current",
      complete: true,
      skills: [{ path: "SKILL.md", name: "clean-skill", valid: true }],
      findings: [],
      aiEvaluation: "disabled",
    };

    const raw = formatCheckSarif([emptyReport]);
    const parsed = JSON.parse(raw);

    const valid = validateSarif(parsed);
    expect(valid, JSON.stringify(validateSarif.errors)).toBe(true);
    expect(parsed.runs[0].results).toEqual([]);
    expect(parsed.runs[0].tool.driver.rules).toEqual([]);
  });
});
