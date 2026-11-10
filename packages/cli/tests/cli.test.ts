import { join, resolve } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config/config.js";
import { createProgram, runCli } from "../src/index.js";
import { requestAiConsent } from "../src/commands/consent.js";
import { ScanError } from "../src/discovery/filesystem.js";
import {
  EXIT_ENGINE_ERROR,
  EXIT_FINDINGS,
  EXIT_INTERNAL_ERROR,
  EXIT_INVALID_ARGUMENTS,
  EXIT_SUCCESS,
} from "../src/core/exit-codes.js";
import {
  formatCheckMarkdown,
  formatCheckTerminal,
  formatDoctorMarkdown,
  formatDoctorTerminal,
  formatEvaluateMarkdown,
  formatEvaluateTerminal,
  formatJson,
  formatTestMarkdown,
  formatTestTerminal,
} from "../src/reporting/index.js";
import type { CheckResult } from "../src/core/check.js";
import type { ScanResult } from "../src/core/scan.js";
import type { TestRun } from "../testing/models.js";
import type { DoctorStatus, EvaluateReport } from "../src/reporting/index.js";

const pythonExecutable = resolve(".venv/Scripts/python.exe");

describe("CLI program structure and command registration", () => {
  it("registers all required Phase 7 commands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain("check");
    expect(commandNames).toContain("scan");
    expect(commandNames).toContain("test");
    expect(commandNames).toContain("doctor");
    expect(commandNames).toContain("evaluate");
  });

  it("provides version and identity matching package specification", () => {
    const program = createProgram();
    expect(program.version()).toBe("0.1.0");
    expect(program.name()).toBe("skillguard");
  });
});

describe("Reporting formatters", () => {
  const sampleFinding = {
    schemaVersion: "1.0" as const,
    ruleId: "SG-SEC-001",
    title: "Plaintext API secret candidate",
    category: "security" as const,
    severity: "high" as const,
    confidence: "high" as const,
    path: "SKILL.md",
    line: 10,
    column: 1,
    message: "A potential plaintext API key was detected.",
    evidence: { redacted: true, excerpt: "[REDACTED]" },
    remediation: "Remove secret and use environment variables.",
    references: [],
  };

  const sampleCheckReport: CheckResult = {
    schemaVersion: "1.0",
    tool: { name: "skillguard", version: "0.1.0" },
    ruleSetVersion: "1.0.0",
    profile: "agent-skills-current",
    complete: true,
    skills: [{ path: "SKILL.md", name: "greeting", valid: true }],
    findings: [sampleFinding],
    aiEvaluation: "disabled",
  };

  const sampleScanReport: ScanResult = {
    ...sampleCheckReport,
    security: {
      status: "completed",
      ruleSetVersion: "1.0.0",
      filesScanned: 3,
      binaryFilesSkipped: 0,
      policy: { suppressed: [], severityChanges: [] },
    },
  };

  it("formats check terminal output with and without verbose", () => {
    const normal = formatCheckTerminal([sampleCheckReport], { verbose: false });
    expect(normal).toContain("Skills: 1; valid: 1; incomplete: false");
    expect(normal).toContain(
      "SKILL.md:10:1 high SG-SEC-001 Plaintext API secret candidate",
    );
    expect(normal).toContain("AI: disabled");
    expect(normal).not.toContain("Remediation:");

    const verbose = formatCheckTerminal([sampleCheckReport], { verbose: true });
    expect(verbose).toContain("Message:     A potential plaintext API key");
    expect(verbose).toContain("Remediation: Remove secret");
  });

  it("formats check terminal output with quiet mode", () => {
    const quiet = formatCheckTerminal([sampleCheckReport], { quiet: true });
    expect(quiet).toBe("");
  });

  it("formats scan terminal output showing security summary", () => {
    const output = formatCheckTerminal([sampleScanReport]);
    expect(output).toContain(
      "Files scanned: 3; binary skipped: 0. No skill scripts executed.",
    );
  });

  it("formats check and scan markdown reports with tables and disclaimers", () => {
    const md = formatCheckMarkdown([sampleScanReport]);
    expect(md).toContain("# SkillGuard Security Scan Report");
    expect(md).toContain("## Skills Overview");
    expect(md).toContain("| `SKILL.md` | `greeting` | Yes |");
    expect(md).toContain("## Findings");
    expect(md).toContain(
      "| **high** | `SG-SEC-001` | `SKILL.md:10:1` | Plaintext API secret candidate |",
    );
    expect(md).toContain("### Finding Details");
    expect(md).toContain("## Security Engine Summary");
    expect(md).toContain("- **Files Scanned:** 3");
    expect(md).toContain(
      "> **Notice:** A clean scan does not prove safety. No skill scripts were executed during analysis.",
    );
  });

  it("formats test terminal and markdown reports", () => {
    const testReport: TestRun = {
      schemaVersion: "1.0",
      passed: 1,
      failed: 1,
      results: [
        { id: "test-pass", passed: true, failures: [], skill: "greeting" },
        {
          id: "test-fail",
          passed: false,
          failures: ["expected greeting"],
          skill: "greeting",
        },
      ],
    };

    const terminal = formatTestTerminal([testReport]);
    expect(terminal).toContain("Recorded fixture tests: 1 passed, 1 failed");
    expect(terminal).toContain("test-fail: expected greeting");

    const md = formatTestMarkdown([testReport]);
    expect(md).toContain("# SkillGuard Fixture Test Report");
    expect(md).toContain("- **Passed:** 1");
    expect(md).toContain("- **Failed:** 1");
    expect(md).toContain(
      "| **FAIL** | `test-fail` | `greeting` | expected greeting |",
    );
  });

  it("formats doctor terminal and markdown reports", () => {
    const doctorStatus: DoctorStatus = {
      node: "22.0.0",
      engine: {
        version: "0.1.0",
        ruleSetVersion: "1.0.0",
        capabilities: ["doctor", "scan", "evaluate"],
      },
      aiEvaluation: "disabled (advisory only)",
      releaseReady: false,
    };

    const terminal = formatDoctorTerminal(doctorStatus, { verbose: true });
    expect(terminal).toContain("Node 22.0.0; Python engine 0.1.0");
    expect(terminal).toContain("Capabilities: doctor, scan, evaluate");
    expect(terminal).toContain("Rule set version: 1.0.0");

    const md = formatDoctorMarkdown(doctorStatus);
    expect(md).toContain("# SkillGuard Doctor Diagnostic Report");
    expect(md).toContain("- **Node.js:** `22.0.0`");
    expect(md).toContain("- **Capabilities:** `doctor`, `scan`, `evaluate`");
  });

  it("formats evaluate terminal and markdown reports", () => {
    const evalReport: EvaluateReport = {
      schemaVersion: "1.0",
      tool: { name: "skillguard", version: "0.1.0" },
      status: "completed",
      root: "/path/to/skill",
      skills: [{ path: "SKILL.md", name: "greeting", valid: true }],
      findings: [
        {
          ...sampleFinding,
          category: "ai-evaluation",
          ruleId: "SG-AI-001",
          title: "Advisory instruction clarity concern",
        },
      ],
      evaluation: {
        provider: "openai",
        model: "test-model",
        promptVersion: "1.0.0",
        advisory: true,
        estimatedCostUsd: 0.000123,
        attempts: 1,
      },
      disclaimer: "AI findings are advisory only.",
    };

    const terminal = formatEvaluateTerminal([evalReport]);
    expect(terminal).toContain(
      "AI evaluation: completed; 1 advisory findings.",
    );
    expect(terminal).toContain("Provider: openai; Model: test-model");
    expect(terminal).toContain("Estimated cost: $0.000123");
    expect(terminal).toContain("AI findings are advisory only.");

    const md = formatEvaluateMarkdown([evalReport]);
    expect(md).toContain("# SkillGuard AI Evaluation Report");
    expect(md).toContain("- **Provider:** `openai`");
    expect(md).toContain("- **Model:** `test-model`");
    expect(md).toContain(
      "| **high** | `SG-AI-001` | `SKILL.md:10:1` | Advisory instruction clarity concern |",
    );
  });

  it("formats generic JSON data cleanly", () => {
    const json = formatJson({ key: "value", number: 42 });
    expect(json).toBe('{\n  "key": "value",\n  "number": 42\n}');
  });
});

describe("User-facing AI consent workflow", () => {
  const enabledConfig = parseConfig({
    aiEvaluation: {
      enabled: true,
      provider: "openai",
      model: "gpt-4o-mini",
      maxCostUsd: 1.0,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
      maxOutputTokens: 1000,
      maxInputBytes: 32768,
      timeoutMs: 15000,
      maxRetries: 1,
    },
  });

  const disabledConfig = parseConfig({});

  it("fails closed when AI evaluation is disabled in configuration", async () => {
    await expect(
      requestAiConsent(disabledConfig, { aiConsent: true }),
    ).rejects.toThrow(ScanError);
    await expect(
      requestAiConsent(disabledConfig, { aiConsent: true }),
    ).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });

  it("grants consent when explicit --ai-consent flag is provided", async () => {
    const result = await requestAiConsent(enabledConfig, { aiConsent: true });
    expect(result).toEqual({ granted: true });
  });

  it("fails closed in non-interactive environments when --ai-consent is missing", async () => {
    const originalIsTTY = process.stdin.isTTY;
    try {
      // Force non-interactive
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });
      await expect(
        requestAiConsent(enabledConfig, { aiConsent: false }),
      ).rejects.toMatchObject({
        code: "CONSENT_REQUIRED",
      });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("prompts interactively and declines when user enters 'n'", async () => {
    const promptFn = vi.fn().mockResolvedValue("n");
    const result = await requestAiConsent(
      enabledConfig,
      { quiet: true },
      promptFn,
    );
    expect(result).toEqual({ granted: false, reason: "DECLINED_BY_USER" });
    expect(promptFn).toHaveBeenCalled();
  });

  it("prompts interactively and grants consent when user enters 'yes'", async () => {
    const promptFn = vi.fn().mockResolvedValue("yes");
    const result = await requestAiConsent(
      enabledConfig,
      { quiet: true },
      promptFn,
    );
    expect(result).toEqual({ granted: true });
    expect(promptFn).toHaveBeenCalled();
  });
});

describe("End-to-end command argument parsing and validation", () => {
  it("rejects unknown commands with Commander error", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "skillguard", "unknown-command"]),
    ).rejects.toThrow();
  });

  it("rejects invalid format on check command", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "skillguard",
        "check",
        "examples/greeting",
        "--format",
        "unsupported-format",
      ]),
    ).rejects.toThrow();
  });

  it("rejects invalid severity threshold on scan command", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "skillguard",
        "scan",
        "examples/greeting",
        "--severity-threshold",
        "catastrophic",
      ]),
    ).rejects.toThrow();
  });

  it("executes check command on examples/greeting with terminal, json, and markdown formats", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));

    try {
      const p1 = createProgram();
      await p1.parseAsync([
        "node",
        "skillguard",
        "check",
        "examples/greeting",
        "--format",
        "terminal",
      ]);
      expect(logs.some((l) => l.includes("Skills: 1; valid: 1"))).toBe(true);

      logs.length = 0;
      const p2 = createProgram();
      await p2.parseAsync([
        "node",
        "skillguard",
        "check",
        "examples/greeting",
        "--format",
        "json",
      ]);
      const json = JSON.parse(logs[0]!);
      expect(json.schemaVersion).toBe("1.0");
      expect(json.skills[0].name).toBe("greeting");

      logs.length = 0;
      const p3 = createProgram();
      await p3.parseAsync([
        "node",
        "skillguard",
        "check",
        "examples/greeting",
        "--format",
        "markdown",
      ]);
      expect(logs[0]).toContain("# SkillGuard Check Report");
    } finally {
      spy.mockRestore();
    }
  });

  it("executes test command on examples/greeting with terminal, json, and markdown formats", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));

    try {
      const p1 = createProgram();
      await p1.parseAsync([
        "node",
        "skillguard",
        "test",
        "examples/greeting",
        "--format",
        "terminal",
      ]);
      expect(
        logs.some((l) => l.includes("Recorded fixture tests: 2 passed")),
      ).toBe(true);

      logs.length = 0;
      const p2 = createProgram();
      await p2.parseAsync([
        "node",
        "skillguard",
        "test",
        "examples/greeting",
        "--format",
        "json",
      ]);
      const json = JSON.parse(logs[0]!);
      expect(json.passed).toBe(2);
      expect(json.failed).toBe(0);

      logs.length = 0;
      const p3 = createProgram();
      await p3.parseAsync([
        "node",
        "skillguard",
        "test",
        "examples/greeting",
        "--format",
        "markdown",
      ]);
      expect(logs[0]).toContain("# SkillGuard Fixture Test Report");
      expect(logs[0]).toContain("- **Passed:** 2");
    } finally {
      spy.mockRestore();
    }
  });

  it("executes doctor command with python executable and markdown format", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));

    try {
      const p = createProgram();
      await p.parseAsync([
        "node",
        "skillguard",
        "doctor",
        "--python",
        pythonExecutable,
        "--format",
        "markdown",
      ]);
      expect(logs[0]).toContain("# SkillGuard Doctor Diagnostic Report");
      expect(logs[0]).toContain("- **Python Engine Version:** `0.1.0`");
    } finally {
      spy.mockRestore();
    }
  });

  it("executes scan command with python executable across terminal, json, and markdown formats", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));

    try {
      const p1 = createProgram();
      await p1.parseAsync([
        "node",
        "skillguard",
        "scan",
        "examples/greeting",
        "--python",
        pythonExecutable,
        "--format",
        "terminal",
      ]);
      expect(
        logs.some((l) => l.includes("Files scanned: 3; binary skipped: 0")),
      ).toBe(true);

      logs.length = 0;
      const p2 = createProgram();
      await p2.parseAsync([
        "node",
        "skillguard",
        "scan",
        "examples/greeting",
        "--python",
        pythonExecutable,
        "--format",
        "json",
      ]);
      const json = JSON.parse(logs[0]!);
      expect(json.security.status).toBe("completed");
      expect(json.security.filesScanned).toBe(3);

      logs.length = 0;
      const p3 = createProgram();
      await p3.parseAsync([
        "node",
        "skillguard",
        "scan",
        "examples/greeting",
        "--python",
        pythonExecutable,
        "--format",
        "markdown",
      ]);
      expect(logs[0]).toContain("# SkillGuard Security Scan Report");
      expect(logs[0]).toContain("- **Files Scanned:** 3");
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects evaluate command when AI evaluation is disabled in configuration", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--ai-consent",
      ]),
    ).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });

  it("rejects evaluate command when --ai-consent is omitted in non-interactive mode", async () => {
    const originalIsTTY = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "skillguard",
          "evaluate",
          "examples/greeting",
        ]),
      ).rejects.toMatchObject({
        code: "INVALID_CONFIG",
      });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("executes check command with format sarif producing valid SARIF document", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));

    try {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "skillguard",
        "check",
        "examples/greeting",
        "--format",
        "sarif",
      ]);
      const sarif = JSON.parse(logs[0]!);
      expect(sarif.$schema).toBe(
        "https://json.schemastore.org/sarif-2.1.0.json",
      );
      expect(sarif.version).toBe("2.1.0");
      expect(sarif.runs[0].tool.driver.name).toBe("skillguard");
      expect(sarif.runs[0].results).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("executes scan command with format sarif producing valid SARIF document", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));

    try {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "skillguard",
        "scan",
        "examples/greeting",
        "--python",
        pythonExecutable,
        "--format",
        "sarif",
      ]);
      const sarif = JSON.parse(logs[0]!);
      expect(sarif.$schema).toBe(
        "https://json.schemastore.org/sarif-2.1.0.json",
      );
      expect(sarif.version).toBe("2.1.0");
      expect(sarif.runs[0].tool.driver.name).toBe("skillguard");
    } finally {
      spy.mockRestore();
    }
  });

  it("interactively prompts and declines evaluation when user enters 'n'", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => logs.push(msg));
    const configPath = resolve("packages/cli/tests/eval-config-declined.json");
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
    try {
      const promptFn = vi.fn().mockResolvedValue("n");
      const program = createProgram(undefined, promptFn);
      await program.parseAsync([
        "node",
        "skillguard",
        "evaluate",
        "examples/greeting",
        "--config",
        configPath,
      ]);
      expect(
        logs.some((l) =>
          l.includes(
            "AI evaluation consent declined. No skill content was sent to any provider.",
          ),
        ),
      ).toBe(true);
      expect(process.exitCode).toBe(0);
    } finally {
      await rm(configPath, { force: true });
      spy.mockRestore();
    }
  });

  describe("Standardized CLI exit codes", () => {
    it("returns EXIT_SUCCESS (0) for clean check, test, and doctor commands", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const codeCheck = await runCli([
          "node",
          "skillguard",
          "check",
          "examples/greeting",
          "--format",
          "json",
        ]);
        expect(codeCheck).toBe(EXIT_SUCCESS);
        expect(process.exitCode).toBe(EXIT_SUCCESS);

        const codeTest = await runCli([
          "node",
          "skillguard",
          "test",
          "examples/greeting",
          "--format",
          "json",
        ]);
        expect(codeTest).toBe(EXIT_SUCCESS);
        expect(process.exitCode).toBe(EXIT_SUCCESS);

        const codeDoctor = await runCli([
          "node",
          "skillguard",
          "doctor",
          "--python",
          pythonExecutable,
          "--format",
          "json",
        ]);
        expect(codeDoctor).toBe(EXIT_SUCCESS);
        expect(process.exitCode).toBe(EXIT_SUCCESS);
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("returns EXIT_FINDINGS (1) when findings cross threshold or tests fail", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tempDir = await mkdtemp(join(tmpdir(), "sg-exit-"));
      try {
        await writeFile(
          join(tempDir, "SKILL.md"),
          "---\nname: failing-test-skill\ndescription: Test skill with intentional failure.\n---\n\nSkill body.\n",
        );
        await writeFile(
          join(tempDir, "skillguard.tests.yaml"),
          `version: 1
tests:
  - id: will-fail
    skill: .
    input:
      prompt: test
    output: "Actual Output"
    assertions:
      - type: contains
        value: "Expected Something Else"
`,
        );
        const codeTest = await runCli([
          "node",
          "skillguard",
          "test",
          tempDir,
          "--format",
          "json",
        ]);
        expect(codeTest).toBe(EXIT_FINDINGS);
        expect(process.exitCode).toBe(EXIT_FINDINGS);

        const invalidSkillDir = join(tempDir, "invalid-skill");
        await mkdir(invalidSkillDir, { recursive: true });
        await writeFile(
          join(invalidSkillDir, "SKILL.md"),
          "---\nname: invalid skill with spaces in name\ndescription: Bad name.\n---\n\nContent.\n",
        );
        const codeCheck = await runCli([
          "node",
          "skillguard",
          "check",
          invalidSkillDir,
          "--format",
          "json",
        ]);
        expect(codeCheck).toBe(EXIT_FINDINGS);
        expect(process.exitCode).toBe(EXIT_FINDINGS);
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("returns EXIT_INVALID_ARGUMENTS (2) for invalid format, unknown commands, or missing required options", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const codeCheck = await runCli([
          "node",
          "skillguard",
          "check",
          "examples/greeting",
          "--format",
          "unsupported_fmt",
        ]);
        expect(codeCheck).toBe(EXIT_INVALID_ARGUMENTS);
        expect(process.exitCode).toBe(EXIT_INVALID_ARGUMENTS);

        const codeUnknown = await runCli([
          "node",
          "skillguard",
          "nonexistent-command",
        ]);
        expect(codeUnknown).toBe(EXIT_INVALID_ARGUMENTS);
        expect(process.exitCode).toBe(EXIT_INVALID_ARGUMENTS);

        const originalIsTTY = process.stdin.isTTY;
        Object.defineProperty(process.stdin, "isTTY", {
          value: false,
          configurable: true,
        });
        try {
          const codeEval = await runCli([
            "node",
            "skillguard",
            "evaluate",
            "examples/greeting",
          ]);
          expect(codeEval).toBe(EXIT_INVALID_ARGUMENTS);
          expect(process.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
        } finally {
          Object.defineProperty(process.stdin, "isTTY", {
            value: originalIsTTY,
            configurable: true,
          });
        }
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("returns EXIT_ENGINE_ERROR (3) when engine protocol fails or engine unavailable", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const codeDoctor = await runCli([
          "node",
          "skillguard",
          "doctor",
          "--python",
          "nonexistent-python-bin-xyz",
        ]);
        expect(codeDoctor).toBe(EXIT_ENGINE_ERROR);
        expect(process.exitCode).toBe(EXIT_ENGINE_ERROR);
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("returns EXIT_INTERNAL_ERROR (4) on cancellation", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const controller = new AbortController();
      controller.abort();
      try {
        const codeCancel = await runCli(
          [
            "node",
            "skillguard",
            "scan",
            "examples/greeting",
            "--python",
            pythonExecutable,
          ],
          controller.signal,
        );
        expect(codeCancel).toBe(EXIT_INTERNAL_ERROR);
        expect(process.exitCode).toBe(EXIT_INTERNAL_ERROR);
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });
});
