import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { PassThrough } from "node:stream";
import Ajv from "ajv";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config/config.js";
import { requestAiConsent } from "../src/commands/consent.js";
import type { EvaluateAdvisoryFn } from "../src/commands/evaluate.js";
import {
  EXIT_INVALID_ARGUMENTS,
  EXIT_SUCCESS,
} from "../src/core/exit-codes.js";
import type { Finding } from "../src/core/models.js";
import { ScanError } from "../src/discovery/filesystem.js";
import { engineEnvironment } from "../src/engine/client.js";
import { runCli } from "../src/index.js";
import { SARIF_SCHEMA_URI, SARIF_VERSION } from "../src/reporting/sarif.js";

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
      },
    },
  },
};
const ajv = new Ajv({ allErrors: true });
const validateSarif = ajv.compile(sarifMetaSchema);

const enabledConfig = parseConfig({
  paths: ["examples/greeting"],
  aiEvaluation: {
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
    maxCostUsd: 1.0,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
});

const mockAdvisoryFinding: Finding = {
  schemaVersion: "1.0",
  ruleId: "SG-AI-001",
  title: "Advisory instruction clarity concern",
  category: "ai-evaluation",
  severity: "medium",
  confidence: "medium",
  path: "SKILL.md",
  line: 1,
  column: 1,
  message: "Clarify input assumptions.",
  evidence: { redacted: true, excerpt: "[AI advisory; source text omitted]" },
  remediation: "Document required inputs clearly.",
  references: [],
};

describe("AI Consent Stream Isolation & Config Filename Verification", () => {
  let tempDir: string;
  let configPath: string;
  let origStdinTTY: boolean | undefined;
  let origStdoutTTY: boolean | undefined;
  let origStderrTTY: boolean | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sg-consent-"));
    configPath = join(tempDir, "skillguard.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        paths: ["examples/greeting"],
        aiEvaluation: {
          enabled: true,
          provider: "openai",
          model: "gpt-4o-mini",
          maxCostUsd: 1.0,
          inputPricePerMillion: 0.15,
          outputPricePerMillion: 0.6,
        },
      }),
    );
    origStdinTTY = process.stdin.isTTY;
    origStdoutTTY = process.stdout.isTTY;
    origStderrTTY = process.stderr.isTTY;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: origStdinTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: origStdoutTTY,
      configurable: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      value: origStderrTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(tempDir, { recursive: true, force: true });
  });

  function setInteractiveTTYs(stdoutIsTTY = false): void {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: stdoutIsTTY,
      configurable: true,
    });
  }

  function setNonInteractiveTTYs(): void {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
  }

  function captureStreams() {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdoutChunks.push(`${args.map(String).join(" ")}\n`);
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrChunks.push(`${args.map(String).join(" ")}\n`);
    });
    vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stderr.write);
    return {
      stdout: () => stdoutChunks.join(""),
      stderr: () => stderrChunks.join(""),
      clear: () => {
        stdoutChunks.length = 0;
        stderrChunks.length = 0;
      },
    };
  }

  it("writes disclosure and prompt exclusively to stderr via readline and uses skillguard.config.json", async () => {
    setInteractiveTTYs(false);
    const { stdout, stderr } = captureStreams();
    const mockInput = new PassThrough();
    mockInput.end("yes\n");

    const result = await requestAiConsent(enabledConfig, {}, undefined, {
      input: mockInput,
    });

    expect(result).toEqual({ granted: true });
    expect(stdout()).toBe("");
    const errText = stderr();
    expect(errText).toContain(
      "=== SkillGuard AI Evaluation Transparency Disclosure ===",
    );
    expect(errText).toContain(
      "Keep 'aiEvaluation.enabled: false' in skillguard.config.json.",
    );
    expect(errText).not.toContain("skillguard.config.yaml");
    expect(errText).toContain(
      "Do you consent to transmitting this skill content to openai? [y/N]:",
    );
  });

  it("never accesses or exposes API credentials before explicit consent", async () => {
    setNonInteractiveTTYs();
    let envKeyAccessed = false;
    const fakeEnv = new Proxy(
      { OPENAI_API_KEY: "sk-test-never-read" },
      {
        get(target, prop) {
          if (prop === "OPENAI_API_KEY") envKeyAccessed = true;
          return Reflect.get(target, prop);
        },
      },
    ) as unknown as NodeJS.ProcessEnv;

    await expect(
      requestAiConsent(enabledConfig, { aiConsent: false }),
    ).rejects.toThrow(ScanError);
    expect(envKeyAccessed).toBe(false);

    // Also verify engineEnvironment strips API key without explicit consent
    const stripped = engineEnvironment(fakeEnv, {
      protocolVersion: "1.0",
      command: "scan",
      files: [],
    });
    expect(stripped.OPENAI_API_KEY).toBeUndefined();
  });

  it("interactive JSON evaluation: user accepts consent; stdout contains only valid JSON and stderr contains consent disclosure", async () => {
    setInteractiveTTYs(false);
    const { stdout, stderr } = captureStreams();
    const mockInput = new PassThrough();
    mockInput.end("yes\n");

    const mockEvaluator = vi.fn<EvaluateAdvisoryFn>().mockResolvedValue({
      status: "completed",
      findings: [mockAdvisoryFinding],
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        promptVersion: "1.0.0",
        advisory: true,
        estimatedCostUsd: 0.0002,
        attempts: 1,
      },
    });

    const code = await runCli(
      [
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
        "--format",
        "json",
      ],
      undefined,
      undefined,
      mockEvaluator,
      { input: mockInput },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(mockEvaluator).toHaveBeenCalledTimes(1);

    const out = stdout();
    const err = stderr();
    expect(err).toContain(
      "=== SkillGuard AI Evaluation Transparency Disclosure ===",
    );
    expect(err).toContain("skillguard.config.json");
    expect(err).toContain(
      "Do you consent to transmitting this skill content to openai? [y/N]:",
    );

    expect(out).not.toContain("Disclosure");
    expect(out).not.toContain("Do you consent");
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("completed");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].ruleId).toBe("SG-AI-001");
  });

  it("interactive SARIF evaluation: user accepts consent; stdout contains only valid SARIF 2.1.0 JSON", async () => {
    setInteractiveTTYs(false);
    const { stdout, stderr } = captureStreams();
    const mockInput = new PassThrough();
    mockInput.end("y\n");

    const mockEvaluator = vi.fn<EvaluateAdvisoryFn>().mockResolvedValue({
      status: "completed",
      findings: [mockAdvisoryFinding],
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        promptVersion: "1.0.0",
        advisory: true,
        estimatedCostUsd: 0.0002,
        attempts: 1,
      },
    });

    const code = await runCli(
      [
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
        "--format",
        "sarif",
      ],
      undefined,
      undefined,
      mockEvaluator,
      { input: mockInput },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(mockEvaluator).toHaveBeenCalledTimes(1);

    const out = stdout();
    const err = stderr();
    expect(err).toContain("SkillGuard AI Evaluation Transparency Disclosure");
    expect(out).not.toContain("Disclosure");
    expect(out).not.toContain("Do you consent");

    const sarif = JSON.parse(out);
    const valid = validateSarif(sarif);
    expect(valid, JSON.stringify(validateSarif.errors)).toBe(true);
    expect(sarif.runs[0].results[0].ruleId).toBe("SG-AI-001");
  });

  it("interactive JSON and SARIF evaluation: user declines consent; no provider contact and stdout remains valid", async () => {
    setInteractiveTTYs(false);
    const { stdout, stderr, clear } = captureStreams();
    const mockEvaluator = vi.fn<EvaluateAdvisoryFn>();

    // Declined JSON evaluation
    const jsonInput = new PassThrough();
    jsonInput.end("n\n");
    const jsonCode = await runCli(
      [
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
        "--format",
        "json",
      ],
      undefined,
      undefined,
      mockEvaluator,
      { input: jsonInput },
    );

    expect(jsonCode).toBe(EXIT_SUCCESS);
    expect(mockEvaluator).not.toHaveBeenCalled();
    expect(stderr()).toContain("Transparency Disclosure");
    const declinedJson = JSON.parse(stdout());
    expect(declinedJson.status).toBe("disabled");
    expect(declinedJson.errorCode).toBe("DECLINED_BY_USER");

    // Declined SARIF evaluation
    clear();
    const sarifInput = new PassThrough();
    sarifInput.end("no\n");
    const sarifCode = await runCli(
      [
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
        "--format",
        "sarif",
      ],
      undefined,
      undefined,
      mockEvaluator,
      { input: sarifInput },
    );

    expect(sarifCode).toBe(EXIT_SUCCESS);
    expect(mockEvaluator).not.toHaveBeenCalled();
    expect(stderr()).toContain("Transparency Disclosure");
    const sarif = JSON.parse(stdout());
    expect(validateSarif(sarif)).toBe(true);
    expect(sarif.runs[0].results).toEqual([]);
  });

  it("fails closed in non-interactive mode when --ai-consent is missing with clean stdout", async () => {
    setNonInteractiveTTYs();
    const { stdout, stderr } = captureStreams();
    const mockEvaluator = vi.fn<EvaluateAdvisoryFn>();

    const code = await runCli(
      [
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
        "--format",
        "sarif",
      ],
      undefined,
      undefined,
      mockEvaluator,
    );

    expect(code).toBe(EXIT_INVALID_ARGUMENTS);
    expect(mockEvaluator).not.toHaveBeenCalled();
    expect(stdout()).toBe("");
    expect(stderr()).toContain("CONSENT_REQUIRED");
  });

  it("succeeds in non-interactive mode with explicit --ai-consent leaving stderr free of interactive prompts and stdout pure", async () => {
    setNonInteractiveTTYs();
    const { stdout, stderr } = captureStreams();
    const mockEvaluator = vi.fn<EvaluateAdvisoryFn>().mockResolvedValue({
      status: "completed",
      findings: [mockAdvisoryFinding],
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        promptVersion: "1.0.0",
        advisory: true,
        estimatedCostUsd: 0.0001,
        attempts: 1,
      },
    });

    const code = await runCli(
      [
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
        "--format",
        "sarif",
        "--ai-consent",
      ],
      undefined,
      undefined,
      mockEvaluator,
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(mockEvaluator).toHaveBeenCalledTimes(1);
    expect(stderr()).toBe("");
    const sarif = JSON.parse(stdout());
    expect(validateSarif(sarif)).toBe(true);
    expect(sarif.runs[0].results[0].ruleId).toBe("SG-AI-001");
  });
});
