import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { crossesThreshold } from "../src/core/models.js";
import type { Finding } from "../src/core/models.js";
import {
  EngineError,
  isFinding,
  validateRequest,
  validateResponse,
} from "../src/engine/protocol.js";

const finding: Finding = {
  schemaVersion: "1.0",
  ruleId: "SG-SEC-001",
  title: "Credential candidate",
  category: "security",
  severity: "high",
  confidence: "high",
  path: "demo/SKILL.md",
  line: 1,
  column: 1,
  message: "Review a credential candidate.",
  evidence: { redacted: true, excerpt: "[REDACTED]" },
  remediation: "Remove and rotate credentials.",
  references: [],
};

describe("versioned contracts", () => {
  it.each(["doctor-response", "error-response"])(
    "accepts shared %s golden",
    async (name) => {
      const value: unknown = JSON.parse(
        await readFile(
          new URL(`../../protocol/fixtures/${name}.json`, import.meta.url),
          "utf8",
        ),
      );
      expect(validateResponse(value)).toEqual(value);
    },
  );
  it("accepts doctor and bounded scan content", () => {
    expect(
      validateRequest({ protocolVersion: "1.0", command: "doctor", files: [] })
        .command,
    ).toBe("doctor");
    expect(
      validateRequest({
        protocolVersion: "1.0",
        command: "scan",
        files: [{ path: "demo/SKILL.md", content: "Untrusted data" }],
      }).files,
    ).toHaveLength(1);
  });
  it.each([
    null,
    [],
    {},
    { protocolVersion: "2.0", command: "scan", files: [] },
    { protocolVersion: "1.0", command: "execute", files: [] },
    {
      protocolVersion: "1.0",
      command: "doctor",
      files: [{ path: "x", content: "" }],
    },
    { protocolVersion: "1.0", command: "scan", files: [], root: "/private" },
    {
      protocolVersion: "1.0",
      command: "scan",
      files: [{ path: "x", content: "a".repeat(262145) }],
    },
  ])("rejects malformed request %# without echoing input", (value) => {
    expect(() => validateRequest(value)).toThrow(EngineError);
  });
  it.each([
    "../secret",
    "a/../../secret",
    "/etc/passwd",
    "C:/Windows/a",
    "C:\\a",
    "\\\\server\\x",
    "a//b",
    "a/./b",
    "a\0b",
  ])("rejects unsafe protocol path %s", (path) => {
    expect(() =>
      validateRequest({
        protocolVersion: "1.0",
        command: "scan",
        files: [{ path, content: "" }],
      }),
    ).toThrow(EngineError);
  });
  it("rejects duplicate paths", () => {
    expect(() =>
      validateRequest({
        protocolVersion: "1.0",
        command: "scan",
        files: [
          { path: "x", content: "" },
          { path: "x", content: "" },
        ],
      }),
    ).toThrow("unique");
  });
  it("validates every finding field", () => {
    expect(isFinding(finding)).toBe(true);
    for (const key of Object.keys(finding)) {
      const value = { ...finding } as Record<string, unknown>;
      delete value[key];
      expect(isFinding(value)).toBe(false);
    }
  });
  it.each([
    { severity: "warning" },
    { line: 0 },
    { column: -1 },
    { path: "../secret" },
    { evidence: { redacted: false, excerpt: "private" } },
    { extra: true },
  ])("rejects malformed finding %#", (patch) => {
    expect(isFinding({ ...finding, ...patch })).toBe(false);
  });
  it("rejects version mismatches distinctly", () => {
    expect(() => validateResponse({ protocolVersion: "2.0" })).toThrow(
      "incompatible",
    );
  });
  it.each([
    { protocolVersion: "1.0", ok: true, findings: [] },
    { protocolVersion: "1.0", ok: false, findings: [] },
    {
      protocolVersion: "1.0",
      ok: false,
      findings: [finding],
      error: { code: "FAILURE", message: "Failed", retryable: false },
    },
    {
      protocolVersion: "1.0",
      ok: true,
      findings: [],
      engine: { version: "0.1.0", capabilities: ["scan"], ruleSetVersion: "1" },
      error: { code: "FAILURE", message: "Failed", retryable: false },
    },
  ])("rejects inconsistent responses %#", (value) => {
    expect(() => validateResponse(value)).toThrow(EngineError);
  });
});

describe("quality gates", () => {
  it("fails at the threshold, not below", () => {
    expect(crossesThreshold([finding], "high")).toBe(true);
    expect(crossesThreshold([finding], "critical")).toBe(false);
  });
  it("strict includes informational findings", () => {
    expect(
      crossesThreshold([{ ...finding, severity: "info" }], "high", true),
    ).toBe(true);
  });
  it("AI findings are advisory even in strict mode", () => {
    expect(
      crossesThreshold(
        [{ ...finding, category: "ai-evaluation", severity: "critical" }],
        "info",
        true,
      ),
    ).toBe(false);
    expect(
      crossesThreshold(
        [finding, { ...finding, category: "ai-evaluation" }],
        "high",
      ),
    ).toBe(true);
  });
});
