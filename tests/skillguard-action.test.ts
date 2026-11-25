import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActionInputError,
  EXIT_ENGINE_ERROR,
  EXIT_FINDINGS,
  EXIT_INTERNAL_ERROR,
  EXIT_INVALID_ARGUMENTS,
  EXIT_SUCCESS,
  MAX_SARIF_BYTES,
  buildCliArgs,
  buildSanitizedCliEnv,
  escapeMarkdownCell,
  isValidFinding,
  parseActionInputs,
  parseValidatedCliReports,
  redactHostPaths,
  renderFallbackErrorSummary,
  renderStepSummaryFromJson,
  resolveActionPython,
  runSkillGuardAction,
  validateSafeCliPathInput,
  validateSarifContent,
  validateSarifFile,
} from "../.github/actions/skillguard/run.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const ACTION_DIR = resolve(REPO_ROOT, ".github", "actions", "skillguard");
const ACTION_YML_PATH = resolve(ACTION_DIR, "action.yml");
const RUN_MJS_PATH = resolve(ACTION_DIR, "run.mjs");

interface SpawnCall {
  executable: string;
  args: string[];
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    shell?: boolean;
  };
}

interface MockCliResponse {
  status: number | null;
  stdout?: string;
  stderr?: string;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

function makeReportJson(overrides: {
  complete?: boolean;
  skills?: Array<{ path: string; name: string | null; valid: boolean }>;
  findings?: Array<{
    schemaVersion?: string;
    ruleId: string;
    title: string;
    category?: string;
    severity: string;
    confidence?: string;
    path: string;
    line: number;
    column: number;
    message?: string;
    evidence?: { redacted: true; excerpt: string };
    remediation?: string;
    references?: string[];
  }>;
}): string {
  return JSON.stringify({
    schemaVersion: "1.0",
    tool: { name: "skillguard", version: "0.1.0" },
    ruleSetVersion: "1.0.0",
    profile: "agent-skills-current",
    complete: overrides.complete ?? true,
    skills: overrides.skills ?? [],
    findings: (overrides.findings ?? []).map((f) => ({
      schemaVersion: f.schemaVersion ?? "1.0",
      ruleId: f.ruleId,
      title: f.title,
      category: f.category ?? "security",
      severity: f.severity,
      confidence: f.confidence ?? "high",
      path: f.path,
      line: f.line,
      column: f.column,
      message: f.message ?? f.title,
      evidence: f.evidence ?? { redacted: true, excerpt: "[Content omitted]" },
      remediation: f.remediation ?? "Fix the issue.",
      references: f.references ?? [],
    })),
    aiEvaluation: "disabled",
  });
}

const VALID_SARIF_DOC = JSON.stringify({
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: [
    {
      tool: {
        driver: {
          name: "SkillGuard",
        },
      },
      results: [
        {
          ruleId: "SG-EXEC-001",
          level: "error",
          message: { text: "Shell invocation detected" },
        },
      ],
    },
  ],
});

const EMPTY_RESULTS_SARIF_DOC = JSON.stringify({
  version: "2.1.0",
  $schema:
    "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
  runs: [
    {
      tool: {
        driver: {
          name: "SkillGuard",
        },
      },
      results: [],
    },
  ],
});

const tempDirs: string[] = [];

function makeTempDir(prefix = "skillguard-action-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseGitHubOutput(filePath: string): Record<string, string> {
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const result: Record<string, string> = {};
  for (const line of lines) {
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      result[line.slice(0, eqIndex)] = line.slice(eqIndex + 1);
    }
  }
  return result;
}

function createFakeCliRunner(
  responder: (args: string[], call: SpawnCall) => MockCliResponse,
): {
  calls: SpawnCall[];
  spawnFn: (
    executable: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      shell?: boolean;
    },
  ) => MockCliResponse;
} {
  const calls: SpawnCall[] = [];
  const spawnFn = (
    executable: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      shell?: boolean;
    },
  ): MockCliResponse => {
    const call: SpawnCall = { executable, args: [...args], options };
    calls.push(call);
    return responder(args, call);
  };
  return { calls, spawnFn };
}

function resolveBashExecutable(): string | null {
  if (process.platform !== "win32") {
    return existsSync("/bin/bash") ? "/bin/bash" : null;
  }
  for (const candidate of [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractActionStepRunScript(stepName: string): string {
  const yamlText = readFileSync(ACTION_YML_PATH, "utf8");
  const lines = yamlText.split(/\r?\n/);
  const namePattern = new RegExp(`^\\s*-\\s*name:\\s*${stepName}\\s*$`);
  const startIdx = lines.findIndex((line) => namePattern.test(line));
  if (startIdx < 0) {
    throw new Error(`Step "${stepName}" not found in action.yml.`);
  }

  let runIdx = -1;
  let runIndent = 0;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*-\s*name:/.test(line)) break;
    const match = line.match(/^(\s*)run:\s*\|[+-]?\s*$/);
    if (match) {
      runIdx = i;
      runIndent = (match[1] ?? "").length;
      break;
    }
  }
  if (runIdx < 0) {
    throw new Error(`Multiline run block for "${stepName}" not found.`);
  }

  const collected: string[] = [];
  let contentIndent = -1;
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) {
      collected.push("");
      continue;
    }
    const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
    if (indent <= runIndent) break;
    if (contentIndent < 0) contentIndent = indent;
    collected.push(line.slice(contentIndent));
  }
  return `${collected.join("\n")}\n`;
}

function writeExecutableScript(
  dir: string,
  name: string,
  body: string,
): string {
  const filePath = join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, body.replaceAll("\r\n", "\n"), "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

function tryCreateSymlink(
  target: string,
  linkPath: string,
  type: "file" | "dir" | "junction",
): { ok: true } | { ok: false; code: string } {
  try {
    symlinkSync(target, linkPath, type);
    return { ok: true };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "UNKNOWN";
    return { ok: false, code };
  }
}

function createStubReadyWorkspace(
  root: string,
  options: {
    withRegexWorker?: boolean;
    withProtocolPackage?: boolean;
    withBrokenDeps?: boolean;
    venvPythonVersion?: string;
    venvImportsOk?: boolean;
  } = {},
): void {
  const withRegexWorker = options.withRegexWorker ?? true;
  const withProtocolPackage = options.withProtocolPackage ?? true;
  const withBrokenDeps = options.withBrokenDeps ?? false;
  const venvPyVer = options.venvPythonVersion ?? "3.11.9";
  const venvImportsOk = options.venvImportsOk ?? true;

  mkdirSync(join(root, ".github", "actions", "skillguard"), {
    recursive: true,
  });
  mkdirSync(join(root, "packages", "cli", "dist", "testing"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "packages", "cli", "dist", "index.js"),
    "// cli entry\n",
    "utf8",
  );
  if (withRegexWorker) {
    writeFileSync(
      join(root, "packages", "cli", "dist", "testing", "regex-worker.mjs"),
      "// worker\n",
      "utf8",
    );
  }
  writeFileSync(
    join(root, "packages", "cli", "package.json"),
    JSON.stringify({ name: "@skillguard/cli", version: "0.1.0" }),
    "utf8",
  );
  mkdirSync(join(root, "node_modules"), { recursive: true });

  const cliNodeModules = join(root, "packages", "cli", "node_modules");
  if (withProtocolPackage) {
    mkdirSync(join(cliNodeModules, "@skillguard", "protocol", "schema"), {
      recursive: true,
    });
    writeFileSync(
      join(cliNodeModules, "@skillguard", "protocol", "package.json"),
      JSON.stringify({ name: "@skillguard/protocol", version: "0.1.0" }),
      "utf8",
    );
  }
  for (const dep of [
    "commander",
    "zod",
    "ajv",
    "ajv-draft-04",
    "ajv-formats",
    "minimatch",
    "markdown-it",
    "yaml",
  ]) {
    if (withBrokenDeps && dep === "zod") continue;
    mkdirSync(join(cliNodeModules, dep), { recursive: true });
    writeFileSync(
      join(cliNodeModules, dep, "package.json"),
      JSON.stringify({ name: dep, main: "index.js" }),
      "utf8",
    );
    writeFileSync(join(cliNodeModules, dep, "index.js"), "", "utf8");
  }

  writeExecutableScript(
    join(root, ".venv", "bin"),
    "python",
    `#!/bin/sh
if [ "$1" = "-c" ]; then
  case "$2" in
    *"sys.version_info"*) echo "${venvPyVer}"; exit 0 ;;
    *"import jsonschema, skillguard_engine"*) exit ${venvImportsOk ? 0 : 1} ;;
  esac
fi
exit 0
`,
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("SkillGuard composite action runner", () => {
  it("accepts valid commands check, scan, and test while rejecting evaluate and unknown commands", () => {
    for (const command of ["check", "scan", "test"] as const) {
      const parsed = parseActionInputs({ INPUT_COMMAND: command }, REPO_ROOT);
      expect(parsed.command).toBe(command);
    }

    expect(() =>
      parseActionInputs({ INPUT_COMMAND: "evaluate" }, REPO_ROOT),
    ).toThrow(ActionInputError);

    expect(() =>
      parseActionInputs({ INPUT_COMMAND: "unknown-cmd" }, REPO_ROOT),
    ).toThrow(ActionInputError);

    const tempDir = makeTempDir();
    const outputFile = join(tempDir, "github_output.txt");
    const summaryFile = join(tempDir, "github_summary.md");
    const stderrLines: string[] = [];

    const res = runSkillGuardAction({
      workspaceRoot: tempDir,
      env: {
        INPUT_COMMAND: "evaluate",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStderr: (text: string) => {
        stderrLines.push(text);
      },
    });

    expect(res.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
    expect(stderrLines.join("")).toContain("evaluate");
    expect(parseGitHubOutput(outputFile)).toEqual({
      "exit-code": "2",
      "sarif-file": "",
      "sarif-valid": "false",
      "sarif-has-results": "false",
    });
    expect(readFileSync(summaryFile, "utf8")).toContain(
      "SkillGuard Execution Failed",
    );
  });

  it("enforces command-specific option rules for check and test and resolves .venv python for check", () => {
    for (const badEnv of [
      { INPUT_COMMAND: "test", INPUT_FORMAT: "sarif" },
      { INPUT_COMMAND: "test", INPUT_SARIF_FILE: "out.sarif" },
      { INPUT_COMMAND: "test", INPUT_STRICT: "true" },
      { INPUT_COMMAND: "test", INPUT_SEVERITY_THRESHOLD: "high" },
    ]) {
      expect(() => parseActionInputs(badEnv, REPO_ROOT)).toThrow(
        ActionInputError,
      );
      const errStderr: string[] = [];
      const errRes = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: makeTempDir(),
        env: { ...badEnv, INPUT_STEP_SUMMARY: "false" },
        writeStderr: (t: string) => errStderr.push(t),
      });
      expect(errRes.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
      expect(errStderr.join("")).toContain("INVALID_ARGUMENTS");
    }

    const tempDir = makeTempDir();
    const fakeCli = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: "Check passed\n",
    }));

    const checkRes = runSkillGuardAction({
      platform: "linux",
      actionRoot: "/opt/skillguard",
      workspaceRoot: tempDir,
      isFile: (p: string) =>
        p === "/opt/skillguard/packages/cli/dist/index.js" ||
        p === "/opt/skillguard/.venv/bin/python",
      spawnFn: fakeCli.spawnFn,
      env: {
        INPUT_COMMAND: "check",
        INPUT_PATH: "examples/greeting",
        INPUT_STEP_SUMMARY: "false",
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(checkRes.exitCode).toBe(EXIT_SUCCESS);
    expect(fakeCli.calls[0]?.args).toContain("--python");
    expect(fakeCli.calls[0]?.args).toContain(
      "/opt/skillguard/.venv/bin/python",
    );
  });

  it("prevents CLI option injection in path and config inputs and uses -- separator before path", () => {
    for (const optionLikePath of ["--help", "-h", "-V", "--strict"]) {
      expect(() =>
        parseActionInputs(
          { INPUT_COMMAND: "scan", INPUT_PATH: optionLikePath },
          REPO_ROOT,
        ),
      ).toThrow(ActionInputError);

      const tempDir = makeTempDir();
      const outputFile = join(tempDir, "output.txt");
      const stderrLines: string[] = [];
      const res = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: tempDir,
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: optionLikePath,
          INPUT_STEP_SUMMARY: "false",
          GITHUB_OUTPUT: outputFile,
        },
        writeStdout: () => {},
        writeStderr: (t: string) => stderrLines.push(t),
      });

      expect(res.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
      expect(parseGitHubOutput(outputFile)["exit-code"]).toBe("2");
      expect(stderrLines.join("")).toContain("INVALID_ARGUMENTS");
    }

    for (const optionLikeConfig of [
      "-h",
      "--help",
      "--format=json",
      "--config",
    ]) {
      expect(() =>
        parseActionInputs(
          { INPUT_COMMAND: "scan", INPUT_CONFIG: optionLikeConfig },
          REPO_ROOT,
        ),
      ).toThrow(ActionInputError);

      const res = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: makeTempDir(),
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: "examples/greeting",
          INPUT_CONFIG: optionLikeConfig,
          INPUT_STEP_SUMMARY: "false",
        },
        writeStdout: () => {},
        writeStderr: () => {},
      });
      expect(res.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
    }

    expect(() =>
      buildCliArgs(
        "/repo/packages/cli/dist/index.js",
        {
          command: "scan",
          path: "--help",
          config: undefined,
          severityThreshold: undefined,
          strict: false,
          format: "terminal",
          sarifFile: undefined,
          stepSummary: false,
          uploadSarif: false,
          quiet: false,
          verbose: false,
        },
        {},
      ),
    ).toThrow(ActionInputError);

    expect(() =>
      parseActionInputs(
        { INPUT_COMMAND: "scan", INPUT_PATH: "   " },
        REPO_ROOT,
      ),
    ).toThrow(ActionInputError);

    const parsedSpaces = parseActionInputs(
      {
        INPUT_COMMAND: "scan",
        INPUT_PATH: "skills/my cool skill/SKILL.md",
        INPUT_CONFIG: "configs/my config.json",
        INPUT_SEVERITY_THRESHOLD: "high",
        INPUT_STRICT: "true",
      },
      REPO_ROOT,
    );
    expect(
      buildCliArgs("/repo/packages/cli/dist/index.js", parsedSpaces, {
        pythonExecutable: "/repo/.venv/bin/python",
      }),
    ).toEqual([
      "/repo/packages/cli/dist/index.js",
      "scan",
      "--config",
      "configs/my config.json",
      "--format",
      "terminal",
      "--no-color",
      "--python",
      "/repo/.venv/bin/python",
      "--severity-threshold",
      "high",
      "--strict",
      "--",
      "skills/my cool skill/SKILL.md",
    ]);

    const absSkillPath = resolve(REPO_ROOT, "examples", "greeting");
    const parsedAbs = parseActionInputs(
      { INPUT_COMMAND: "check", INPUT_PATH: absSkillPath },
      REPO_ROOT,
    );
    const absArgs = buildCliArgs("/repo/packages/cli/dist/index.js", parsedAbs);
    expect(absArgs.slice(-2)).toEqual(["--", absSkillPath]);
  });

  it("preserves shell metacharacters after -- and enforces shell: false", () => {
    const tempDir = makeTempDir();
    const outputFile = join(tempDir, "output.txt");
    const summaryFile = join(tempDir, "summary.md");
    const markerFile = join(tempDir, "should-not-exist.txt");
    const maliciousPath = `examples/greeting; echo PWNED > "${markerFile}" && $(id) \`uname\``;

    const fakeCli = createFakeCliRunner(() => ({
      status: EXIT_FINDINGS,
      stdout: makeReportJson({
        skills: [{ path: maliciousPath, name: "evil-name", valid: false }],
        findings: [],
      }),
    }));

    const res = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      isFile: () => true,
      spawnFn: fakeCli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_PATH: maliciousPath,
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(res.exitCode).toBe(EXIT_FINDINGS);
    expect(existsSync(markerFile)).toBe(false);
    expect(fakeCli.calls).toHaveLength(1);
    const call = fakeCli.calls[0];
    expect(call?.options.shell).toBe(false);
    expect(call?.args.slice(-2)).toEqual(["--", maliciousPath]);
  });

  it("propagates exact exit codes 0, 1, 2, 3, and 4 from CLI and invalid outputs", () => {
    const codes = [
      EXIT_SUCCESS,
      EXIT_FINDINGS,
      EXIT_INVALID_ARGUMENTS,
      EXIT_ENGINE_ERROR,
      EXIT_INTERNAL_ERROR,
    ] as const;

    for (const code of codes) {
      const tempDir = makeTempDir();
      const outputFile = join(tempDir, "output.txt");
      const summaryFile = join(tempDir, "summary.md");

      const fakeCli = createFakeCliRunner(() => ({
        status: code,
        stdout: code <= 1 ? makeReportJson({}) : "",
        stderr: code >= 2 ? `ERR_${code}: simulated failure\n` : "",
      }));

      const res = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: tempDir,
        isFile: () => true,
        spawnFn: fakeCli.spawnFn,
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: "examples/greeting",
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: summaryFile,
        },
        writeStdout: () => {},
        writeStderr: () => {},
      });

      expect(res.exitCode).toBe(code);
      expect(parseGitHubOutput(outputFile)["exit-code"]).toBe(String(code));
    }

    const tempInvalid = makeTempDir();
    const outInvalid = join(tempInvalid, "out.txt");
    const stderrInvalid: string[] = [];
    const invalidJsonCli = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: "NOT_VALID_JSON",
    }));

    const invalidOutRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempInvalid,
      isFile: () => true,
      spawnFn: invalidJsonCli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "json",
        INPUT_PATH: "examples/greeting",
        INPUT_STEP_SUMMARY: "false",
        GITHUB_OUTPUT: outInvalid,
      },
      writeStdout: () => {},
      writeStderr: (t: string) => stderrInvalid.push(t),
    });

    expect(invalidOutRes.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(parseGitHubOutput(outInvalid)["exit-code"]).toBe("4");
    expect(stderrInvalid.join("")).toContain("INVALID_OUTPUT");
  });

  it("strips OPENAI_API_KEY, GITHUB_TOKEN, and non-allowlisted secrets from CLI subprocess env", () => {
    const clean = buildSanitizedCliEnv({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      SKILLGUARD_PYTHON: "/custom/python",
      OPENAI_API_KEY: "sk-proj-supersecretkeyvalue1234567890",
      GITHUB_TOKEN: "ghp_supersecretgithubtoken1234567890",
      GH_TOKEN: "gho_supersecretghtoken1234567890",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
    });

    expect(clean["PATH"]).toBe("/usr/bin");
    expect(clean["HOME"]).toBe("/home/runner");
    expect(clean["SKILLGUARD_PYTHON"]).toBe("/custom/python");
    expect(clean["NO_COLOR"]).toBe("1");
    expect(clean["FORCE_COLOR"]).toBe("0");
    expect("OPENAI_API_KEY" in clean).toBe(false);
    expect("GITHUB_TOKEN" in clean).toBe(false);
    expect("GH_TOKEN" in clean).toBe(false);
    expect("AWS_SECRET_ACCESS_KEY" in clean).toBe(false);

    const tempDir = makeTempDir();
    const fakeCli = createFakeCliRunner(() => ({ status: 0, stdout: "" }));
    runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      isFile: () => true,
      spawnFn: fakeCli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_PATH: "examples/greeting",
        INPUT_STEP_SUMMARY: "false",
        OPENAI_API_KEY: "sk-secret-value-1234567890123456",
        GITHUB_TOKEN: "ghp_secret_value_1234567890123456",
        AWS_SECRET_ACCESS_KEY: "aws-secret-value",
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });

    const passedEnv = fakeCli.calls[0]?.options.env ?? {};
    expect(passedEnv["OPENAI_API_KEY"]).toBeUndefined();
    expect(passedEnv["GITHUB_TOKEN"]).toBeUndefined();
    expect(passedEnv["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
  });

  it("resolves cross-platform .venv Python on Windows, Linux, and macOS and honors SKILLGUARD_PYTHON", () => {
    const winRoot = "C:\\repo\\skillguard";
    expect(
      resolveActionPython({
        platform: "win32",
        actionRoot: winRoot,
        workspaceRoot: winRoot,
        env: {},
        isFile: (p: string) =>
          p === win32.resolve(winRoot, ".venv", "Scripts", "python.exe"),
      }),
    ).toBe(win32.resolve(winRoot, ".venv", "Scripts", "python.exe"));

    const posixRoot = "/home/runner/work/skillguard/skillguard";
    for (const platform of ["linux", "darwin"] as const) {
      expect(
        resolveActionPython({
          platform,
          actionRoot: posixRoot,
          workspaceRoot: posixRoot,
          env: {},
          isFile: (p: string) =>
            p === posix.resolve(posixRoot, ".venv", "bin", "python"),
        }),
      ).toBe(posix.resolve(posixRoot, ".venv", "bin", "python"));
    }

    expect(
      resolveActionPython({
        platform: "linux",
        actionRoot: posixRoot,
        workspaceRoot: "/workspace/repo",
        env: { SKILLGUARD_PYTHON: "./custom/bin/python3" },
      }),
    ).toBe("/workspace/repo/custom/bin/python3");

    expect(
      resolveActionPython({
        platform: "linux",
        actionRoot: posixRoot,
        workspaceRoot: posixRoot,
        env: {},
        isFile: () => false,
      }),
    ).toBe("python");
  });

  it("enforces SARIF 2.1.0 schema and size limits and cleans up stale files on invalid SARIF", () => {
    expect(validateSarifContent("").valid).toBe(false);
    expect(validateSarifContent("{bad-json").valid).toBe(false);
    expect(
      validateSarifContent(JSON.stringify({ version: "2.0.0" })).valid,
    ).toBe(false);

    const parsedValid = validateSarifContent(VALID_SARIF_DOC);
    expect(parsedValid.valid).toBe(true);
    expect(parsedValid.hasResults).toBe(true);
    expect(parsedValid.resultCount).toBe(1);

    const parsedEmpty = validateSarifContent(EMPTY_RESULTS_SARIF_DOC);
    expect(parsedEmpty.valid).toBe(true);
    expect(parsedEmpty.hasResults).toBe(false);

    const oversizedRaw = JSON.stringify({
      version: "2.1.0",
      pad: "x".repeat(MAX_SARIF_BYTES + 1),
    });
    const oversizedCheck = validateSarifContent(oversizedRaw);
    expect(oversizedCheck.valid).toBe(false);
    expect(oversizedCheck.reason).toContain("exceeds maximum");

    const tempDir = makeTempDir();
    const zeroByteFile = join(tempDir, "empty.sarif");
    writeFileSync(zeroByteFile, "", "utf8");
    expect(validateSarifFile(zeroByteFile).valid).toBe(false);
    expect(validateSarifFile(join(tempDir, "missing.sarif")).valid).toBe(false);

    const oversizedDiskFile = join(tempDir, "huge.sarif");
    writeFileSync(
      oversizedDiskFile,
      Buffer.alloc(MAX_SARIF_BYTES + 1024, 0x20),
    );
    expect(validateSarifFile(oversizedDiskFile).valid).toBe(false);
    expect(validateSarifFile(oversizedDiskFile).reason).toContain(
      "exceeds maximum",
    );

    const outputFile = join(tempDir, "output.txt");
    const sarifOutRel = "reports/stale-invalid.sarif";
    const sarifOutAbs = join(tempDir, sarifOutRel);
    mkdirSync(join(tempDir, "reports"), { recursive: true });
    writeFileSync(sarifOutAbs, "STALE_PRIOR_SARIF", "utf8");

    const badSarifCli = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: "{}",
    }));

    const res = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      cliRenderers: null,
      isFile: () => true,
      spawnFn: badSarifCli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "sarif",
        INPUT_SARIF_FILE: sarifOutRel,
        INPUT_STEP_SUMMARY: "false",
        GITHUB_OUTPUT: outputFile,
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(res.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(res.sarifValid).toBe(false);
    expect(res.sarifHasResults).toBe(false);
    expect(res.sarifFile).toBe("");
    expect(existsSync(sarifOutAbs)).toBe(false);
    expect(parseGitHubOutput(outputFile)).toEqual({
      "exit-code": "4",
      "sarif-file": "",
      "sarif-valid": "false",
      "sarif-has-results": "false",
    });
  });

  it("blocks existing/dangling symlinks, directory symlinks/junctions, '.' and directory SARIF destinations", () => {
    const tempDir = makeTempDir();
    const workspace = join(tempDir, "ws");
    const outside = join(tempDir, "outside");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });

    // Reject '.' and existing directory destinations cleanly in input & writer checks
    expect(() =>
      parseActionInputs(
        { INPUT_COMMAND: "scan", INPUT_SARIF_FILE: "." },
        workspace,
      ),
    ).toThrow(ActionInputError);
    expect(() =>
      parseActionInputs(
        { INPUT_COMMAND: "scan", INPUT_SARIF_FILE: "reports/" },
        workspace,
      ),
    ).toThrow(ActionInputError);
    expect(() =>
      parseActionInputs(
        { INPUT_COMMAND: "scan", INPUT_SARIF_FILE: "../escape.sarif" },
        workspace,
      ),
    ).toThrow(ActionInputError);

    const existingDir = join(workspace, "existing-dir");
    mkdirSync(existingDir, { recursive: true });
    const dirDestRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: workspace,
      cliRenderers: null,
      isFile: () => true,
      spawnFn: () => ({ status: EXIT_SUCCESS, stdout: VALID_SARIF_DOC }),
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "sarif",
        INPUT_SARIF_FILE: "existing-dir",
        INPUT_STEP_SUMMARY: "false",
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });
    expect(dirDestRes.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
    expect(dirDestRes.sarifValid).toBe(false);

    // Normal nested directory creation succeeds cleanly
    const nestedOut = join(tempDir, "nested-out.txt");
    const nestedRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: workspace,
      cliRenderers: null,
      isFile: () => true,
      spawnFn: () => ({ status: EXIT_FINDINGS, stdout: VALID_SARIF_DOC }),
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "sarif",
        INPUT_SARIF_FILE: "reports/deep/nested/skillguard.sarif",
        INPUT_STEP_SUMMARY: "false",
        GITHUB_OUTPUT: nestedOut,
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });
    expect(nestedRes.exitCode).toBe(EXIT_FINDINGS);
    expect(nestedRes.sarifValid).toBe(true);
    expect(nestedRes.sarifHasResults).toBe(true);
    expect(
      validateSarifFile(
        join(workspace, "reports", "deep", "nested", "skillguard.sarif"),
      ).valid,
    ).toBe(true);

    // Intermediate directory symlink or Windows junction blocks mkdirSync before external mutation
    const dirLinkPath = join(workspace, "linked-reports");
    const dirLinkType = process.platform === "win32" ? "junction" : "dir";
    const dirLinkCreated = tryCreateSymlink(outside, dirLinkPath, dirLinkType);
    expect(dirLinkCreated.ok).toBe(true);

    const dirTraverseRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: workspace,
      cliRenderers: null,
      isFile: () => true,
      spawnFn: () => ({ status: EXIT_SUCCESS, stdout: VALID_SARIF_DOC }),
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "sarif",
        INPUT_SARIF_FILE: "linked-reports/sub/out.sarif",
        INPUT_STEP_SUMMARY: "false",
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });
    expect(dirTraverseRes.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
    expect(dirTraverseRes.sarifValid).toBe(false);
    expect(existsSync(join(outside, "sub"))).toBe(false);

    // Stale SARIF cleanup through directory symlink/junction must NEVER delete outside file
    const outsideKeepFile = join(outside, "keep-me.sarif");
    writeFileSync(outsideKeepFile, VALID_SARIF_DOC, "utf8");
    const staleCleanupStderr: string[] = [];
    const staleCleanupRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: workspace,
      cliRenderers: null,
      isFile: () => true,
      spawnFn: () => ({
        status: EXIT_ENGINE_ERROR,
        stderr: "ENGINE_UNAVAILABLE: fail\n",
      }),
      env: {
        INPUT_COMMAND: "scan",
        INPUT_SARIF_FILE: "linked-reports/keep-me.sarif",
        INPUT_STEP_SUMMARY: "false",
      },
      writeStdout: () => {},
      writeStderr: (t: string) => staleCleanupStderr.push(t),
    });
    expect(staleCleanupRes.exitCode).toBe(EXIT_ENGINE_ERROR);
    expect(existsSync(outsideKeepFile)).toBe(true);
    expect(staleCleanupStderr.join("")).toContain("INVALID_ARGUMENTS");

    // Existing file symlink and broken/dangling file symlink pointing outside
    const existingOutsideTarget = join(outside, "existing.sarif");
    writeFileSync(existingOutsideTarget, "ORIG", "utf8");
    const fileLinkPath = join(workspace, "file-link.sarif");
    const fileLinkRes = tryCreateSymlink(
      existingOutsideTarget,
      fileLinkPath,
      "file",
    );
    if (fileLinkRes.ok) {
      const existingSymRes = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: workspace,
        cliRenderers: null,
        isFile: () => true,
        spawnFn: () => ({ status: EXIT_SUCCESS, stdout: VALID_SARIF_DOC }),
        env: {
          INPUT_COMMAND: "scan",
          INPUT_FORMAT: "sarif",
          INPUT_SARIF_FILE: "file-link.sarif",
          INPUT_STEP_SUMMARY: "false",
        },
        writeStdout: () => {},
        writeStderr: () => {},
      });
      expect(existingSymRes.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
      expect(readFileSync(existingOutsideTarget, "utf8")).toBe("ORIG");

      const danglingOutsideTarget = join(outside, "created-via-dangling.sarif");
      const danglingLinkPath = join(workspace, "dangling-link.sarif");
      const danglingResCreated = tryCreateSymlink(
        danglingOutsideTarget,
        danglingLinkPath,
        "file",
      );
      expect(danglingResCreated.ok).toBe(true);
      const danglingRunRes = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: workspace,
        cliRenderers: null,
        isFile: () => true,
        spawnFn: () => ({ status: EXIT_SUCCESS, stdout: VALID_SARIF_DOC }),
        env: {
          INPUT_COMMAND: "scan",
          INPUT_FORMAT: "sarif",
          INPUT_SARIF_FILE: "dangling-link.sarif",
          INPUT_STEP_SUMMARY: "false",
        },
        writeStdout: () => {},
        writeStderr: () => {},
      });
      expect(danglingRunRes.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
      expect(existsSync(danglingOutsideTarget)).toBe(false);
    } else {
      // Documented OS privilege guard: Windows without Developer Mode raises EPERM on file symlinks;
      // directory junction traversal and cleanup protections remain fully exercised above.
      expect(fileLinkRes.code).toBe("EPERM");
    }
  });

  it("handles secondary SARIF failures, single-pass scan reuse, and fallback summary codes 0 and 1", () => {
    const tempDir = makeTempDir();
    const out1 = join(tempDir, "out1.txt");
    const sum1 = join(tempDir, "sum1.md");
    const sarif1Rel = "reports/single-pass.sarif";
    const stdoutChunks: string[] = [];

    const singlePassCli = createFakeCliRunner(() => ({
      status: EXIT_FINDINGS,
      stdout: makeReportJson({
        skills: [
          { path: "examples/bad/SKILL.md", name: "bad-skill", valid: false },
        ],
        findings: [
          {
            ruleId: "SG-SEC-001",
            title: "Plaintext token exposed",
            severity: "high",
            path: "examples/bad/SKILL.md",
            line: 12,
            column: 4,
          },
        ],
      }),
    }));

    const singleRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      isFile: () => true,
      spawnFn: singlePassCli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_PATH: "examples/bad",
        INPUT_FORMAT: "terminal",
        INPUT_SARIF_FILE: sarif1Rel,
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: out1,
        GITHUB_STEP_SUMMARY: sum1,
      },
      writeStdout: (t: string) => stdoutChunks.push(t),
      writeStderr: () => {},
    });

    expect(singlePassCli.calls).toHaveLength(1);
    expect(singlePassCli.calls[0]?.args).toContain("--format");
    expect(singlePassCli.calls[0]?.args).toContain("json");
    expect(singleRes.exitCode).toBe(EXIT_FINDINGS);
    expect(singleRes.sarifFile).toBe(sarif1Rel);
    expect(singleRes.sarifValid).toBe(true);
    expect(singleRes.sarifHasResults).toBe(true);
    expect(stdoutChunks.join("")).toContain("SG-SEC-001");
    expect(validateSarifFile(join(tempDir, sarif1Rel)).valid).toBe(true);
    expect(readFileSync(sum1, "utf8")).toContain("SG-SEC-001");

    // Secondary SARIF invocation failure forwards sarifRun.stderr & classifies error accurately
    const out2 = join(tempDir, "out2.txt");
    const sum2 = join(tempDir, "sum2.md");
    const stderr2: string[] = [];
    const preExistingSarif = join(tempDir, "reports", "fallback-stale.sarif");
    writeFileSync(preExistingSarif, VALID_SARIF_DOC, "utf8");

    const secondaryFailCli = createFakeCliRunner((args) => {
      const format = args[args.indexOf("--format") + 1];
      if (format === "sarif") {
        return {
          status: EXIT_ENGINE_ERROR,
          stderr: `ENGINE_TIMEOUT: timed out under ${tempDir}\n`,
        };
      }
      return { status: EXIT_SUCCESS, stdout: "Terminal OK\n" };
    });

    const secRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      cliRenderers: null,
      isFile: () => true,
      spawnFn: secondaryFailCli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "terminal",
        INPUT_SARIF_FILE: "reports/fallback-stale.sarif",
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: out2,
        GITHUB_STEP_SUMMARY: sum2,
      },
      writeStdout: () => {},
      writeStderr: (t: string) => stderr2.push(t),
    });

    expect(secRes.exitCode).toBe(EXIT_ENGINE_ERROR);
    expect(secRes.sarifValid).toBe(false);
    expect(secRes.sarifFile).toBe("");
    expect(existsSync(preExistingSarif)).toBe(false);
    expect(stderr2.join("")).toContain("ENGINE_TIMEOUT:");
    expect(stderr2.join("")).toContain("<workspace>");
    expect(stderr2.join("")).not.toContain(tempDir);
    const secSummary = readFileSync(sum2, "utf8");
    expect(secSummary).toContain("ENGINE_TIMEOUT");
    expect(secSummary).toContain("Exit Code:** `3`");

    // Fallback summaries when JSON parsing fails on CLI exit codes 0 and 1
    const passFallback = renderFallbackErrorSummary(
      "scan",
      EXIT_SUCCESS,
      "INVALID_OUTPUT",
    );
    expect(passFallback).toContain("Step Summary Incomplete");
    expect(passFallback).not.toContain("Execution Failed");
    expect(passFallback).toContain("completed without blocking findings");

    const findingFallback = renderFallbackErrorSummary(
      "check",
      EXIT_FINDINGS,
      "INVALID_OUTPUT",
    );
    expect(findingFallback).toContain("Step Summary Incomplete");
    expect(findingFallback).toContain("reported blocking findings");
  });

  it("escapes Markdown cells and redacts host paths plus GitHub, OpenAI, Slack, and AWS secrets", () => {
    const workspaceRoot = "/home/runner/work/project/repo";
    const actionRoot = "/home/runner/_actions/skillguard/action";
    const knownRoots = [
      { path: workspaceRoot, label: "<workspace>" },
      { path: actionRoot, label: "<redacted-path>" },
    ];

    const escaped = escapeMarkdownCell(
      "bad|pipe `code`\nnext-line <script>alert(1)</script> [link]",
      knownRoots,
    );
    expect(escaped).toBe(
      "bad\\|pipe \\`code\\` next-line &lt;script&gt;alert(1)&lt;/script&gt; \\[link\\]",
    );

    const syntheticAwsKey = "AKIA" + "IOSFODNN7EXAMPLE";
    const syntheticSlackToken = "xoxb-" + "1234567890-abcdef123456";
    const syntheticGhToken = "ghp_" + "AbCdEfGhIjKlMnOpQrStUvWxYz1234";
    const redacted = redactHostPaths(
      `Found in ${workspaceRoot}/skills/a and C:\\Users\\dev\\secret\\SKILL.md ` +
        `gh=${syntheticGhToken} aws=${syntheticAwsKey} slack=${syntheticSlackToken}`,
      knownRoots,
    );
    expect(redacted).toContain("<workspace>/skills/a");
    expect(redacted).not.toContain("/home/runner/work/project/repo");
    expect(redacted).not.toContain("C:\\Users\\dev");
    expect(redacted).not.toContain(syntheticGhToken);
    expect(redacted).not.toContain(syntheticAwsKey);
    expect(redacted).not.toContain(syntheticSlackToken);
    expect(redacted.match(/\[REDACTED_SECRET\]/g)?.length).toBe(3);

    const summary = renderStepSummaryFromJson(
      "scan",
      JSON.stringify({
        complete: true,
        skills: [
          {
            path: `${workspaceRoot}/examples/demo`,
            name: "demo|skill <tag>",
            valid: true,
          },
        ],
        findings: [
          {
            severity: "high",
            ruleId: "SG-001",
            path: `${workspaceRoot}/examples/demo/SKILL.md`,
            line: 4,
            column: 2,
            title: "Pipe | `backtick`\nnewline <img src=x>",
          },
        ],
      }),
      EXIT_FINDINGS,
      knownRoots,
    );

    expect(summary).toContain("&lt;workspace&gt;/examples/demo");
    expect(summary).not.toContain("/home/runner/work/project/repo");
    expect(summary).toContain("demo\\|skill &lt;tag&gt;");
    expect(summary).toContain(
      "Pipe \\| \\`backtick\\` newline &lt;img src=x&gt;",
    );
  });

  it("respects step-summary: false and rejects upload-sarif: true in Step 1", () => {
    const tempDir = makeTempDir();
    const summaryFile = join(tempDir, "summary.md");
    const outputFile = join(tempDir, "output.txt");
    writeFileSync(summaryFile, "", "utf8");

    const cli = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: "All clean\n",
    }));

    const okRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      isFile: () => true,
      spawnFn: cli.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_STEP_SUMMARY: "false",
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_OUTPUT: outputFile,
      },
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(okRes.exitCode).toBe(EXIT_SUCCESS);
    expect(cli.calls).toHaveLength(1);
    expect(readFileSync(summaryFile, "utf8")).toBe("");

    const uploadErrStderr: string[] = [];
    const uploadRes = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_UPLOAD_SARIF: "true",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStderr: (text: string) => {
        uploadErrStderr.push(text);
      },
    });

    expect(uploadRes.exitCode).toBe(EXIT_INVALID_ARGUMENTS);
    expect(uploadErrStderr.join("")).toContain("upload-sarif");
  });

  it("contains zero ${{ inputs.* }} shell interpolations in action.yml and uses SHA-pinned actions", () => {
    const yamlText = readFileSync(ACTION_YML_PATH, "utf8");
    const lines = yamlText.split(/\r?\n/);

    let inRunBlock = false;
    let runIndent = 0;

    for (const line of lines) {
      const runMatch = line.match(/^(\s*)run:\s*(.*)$/);
      if (runMatch) {
        const inlineCommand = runMatch[2] ?? "";
        expect(inlineCommand).not.toMatch(/\$\{\{\s*inputs\./);
        expect(inlineCommand).not.toMatch(/\$\{\{\s*github\.event/);
        if (/^[|>][+-]?$/.test(inlineCommand.trim())) {
          inRunBlock = true;
          runIndent = (runMatch[1] ?? "").length;
        } else {
          inRunBlock = false;
        }
        continue;
      }

      if (inRunBlock) {
        if (line.trim().length > 0) {
          const currentIndent = (line.match(/^(\s*)/)?.[1] ?? "").length;
          if (currentIndent <= runIndent) {
            inRunBlock = false;
          } else {
            expect(line).not.toMatch(/\$\{\{\s*inputs\./);
            expect(line).not.toMatch(/\$\{\{\s*github\.event/);
          }
        }
      }

      const usesMatch = line.match(/^\s*uses:\s*([^\s#]+)/);
      if (usesMatch) {
        const ref = usesMatch[1] ?? "";
        expect(ref).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it(
    "verifies dependency readiness and PEP 668-safe uv bootstrap decisions in action.yml",
    { timeout: 90_000 },
    () => {
      const bashExe = resolveBashExecutable();
      expect(bashExe).not.toBeNull();
      if (!bashExe) return;

      const prepareScript = extractActionStepRunScript(
        "Check runtime and dependency state",
      );
      const installScript = extractActionStepRunScript(
        "Install SkillGuard dependencies and build CLI",
      );

      const runPrepare = (opts: {
        actionRoot: string;
        binDir: string;
        runnerTemp: string;
        mode?: string;
        nodeVersion?: string;
        pythonVersion?: string;
      }) => {
        const ghOut = join(opts.runnerTemp, `gh_out_${Math.random()}.txt`);
        writeFileSync(ghOut, "", "utf8");
        const result = spawnSync(bashExe, ["-s"], {
          input: prepareScript,
          encoding: "utf8",
          env: {
            PATH: `${opts.binDir}${process.platform === "win32" ? ";" : ":"}${process.env["PATH"] ?? ""}`,
            HOME: opts.runnerTemp,
            TMPDIR: opts.runnerTemp,
            RUNNER_TEMP: opts.runnerTemp,
            GITHUB_OUTPUT: ghOut,
            SKILLGUARD_ACTION_PATH: join(
              opts.actionRoot,
              ".github",
              "actions",
              "skillguard",
            ),
            INPUT_INSTALL_DEPENDENCIES: opts.mode ?? "auto",
            INPUT_NODE_VERSION: opts.nodeVersion ?? "22",
            INPUT_PYTHON_VERSION: opts.pythonVersion ?? "3.11",
          },
        });
        return {
          status: result.status,
          stderr: result.stderr ?? "",
          outputs: parseGitHubOutput(ghOut),
        };
      };

      const writeFakeNodeAndPython = (
        binDir: string,
        cfg: { nodeVer: string; pyVer: string; ensurepipOk?: boolean },
      ) => {
        writeExecutableScript(
          binDir,
          "node",
          `#!/bin/sh
if [ "$1" = "-p" ]; then
  echo "${cfg.nodeVer}"
  exit 0
fi
exec "${process.execPath.replaceAll("\\", "/")}" "$@"
`,
        );
        const pyBody = `#!/bin/sh
if [ "$1" = "-c" ]; then
  case "$2" in
    *"sys.version_info"*) echo "${cfg.pyVer}"; exit 0 ;;
    *"import venv, ensurepip"*) exit ${cfg.ensurepipOk === false ? 1 : 0} ;;
    *"sys.executable"*) echo "$0"; exit 0 ;;
  esac
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  echo "FORBIDDEN_SYSTEM_PIP" >> "${binDir.replaceAll("\\", "/")}/sys_pip.log"
  exit 99
fi
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  venv_dir=""
  for arg in "$@"; do
    venv_dir="$arg"
  done
  mkdir -p "$venv_dir/bin"
  cat > "$venv_dir/bin/python" <<'PYEOF'
#!/bin/sh
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  uv_target="$(dirname "$0")/uv"
  cat > "$uv_target" <<'UVEOF'
#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "uv 0.11.28 (isolated)"
  exit 0
fi
echo "ISOLATED_UV:$*" >> "$(dirname "$0")/uv.log"
exit 0
UVEOF
  chmod +x "$uv_target"
  exit 0
fi
exit 0
PYEOF
  chmod +x "$venv_dir/bin/python"
  exit 0
fi
exit 0
`;
        writeExecutableScript(binDir, "python3", pyBody);
        writeExecutableScript(binDir, "python", pyBody);
      };

      // Case 1: Fully ready workspace skips node, python, and install-deps
      const case1 = makeTempDir("prep-ready-");
      const ws1 = join(case1, "ws");
      const bin1 = join(case1, "bin");
      const tmp1 = join(case1, "tmp");
      mkdirSync(tmp1, { recursive: true });
      createStubReadyWorkspace(ws1);
      writeFakeNodeAndPython(bin1, { nodeVer: "22.14.0", pyVer: "3.11.9" });
      const readyRes = runPrepare({
        actionRoot: ws1,
        binDir: bin1,
        runnerTemp: tmp1,
      });
      expect(readyRes.status).toBe(0);
      expect(readyRes.outputs["setup-node"]).toBe("false");
      expect(readyRes.outputs["setup-python"]).toBe("false");
      expect(readyRes.outputs["install-deps"]).toBe("false");

      // Case 2: Missing regex-worker.mjs fails CLI readiness check
      const wsNoWorker = join(case1, "ws-noworker");
      createStubReadyWorkspace(wsNoWorker, { withRegexWorker: false });
      const noWorkerRes = runPrepare({
        actionRoot: wsNoWorker,
        binDir: bin1,
        runnerTemp: tmp1,
      });
      expect(noWorkerRes.status).toBe(0);
      expect(noWorkerRes.outputs["install-deps"]).toBe("true");

      // Case 3: Missing npm dependency fails node_deps readiness check
      const wsBadDeps = join(case1, "ws-baddeps");
      createStubReadyWorkspace(wsBadDeps, { withBrokenDeps: true });
      const badDepsRes = runPrepare({
        actionRoot: wsBadDeps,
        binDir: bin1,
        runnerTemp: tmp1,
      });
      expect(badDepsRes.status).toBe(0);
      expect(badDepsRes.outputs["install-deps"]).toBe("true");

      // Case 4: Empty/unusable .venv (import failure) triggers install-deps
      const wsBadVenv = join(case1, "ws-badvenv");
      createStubReadyWorkspace(wsBadVenv, { venvImportsOk: false });
      const badVenvRes = runPrepare({
        actionRoot: wsBadVenv,
        binDir: bin1,
        runnerTemp: tmp1,
      });
      expect(badVenvRes.status).toBe(0);
      expect(badVenvRes.outputs["install-deps"]).toBe("true");

      // Case 5: Requested custom node-version=24 & python-version=3.12 triggers setup
      const customVerRes = runPrepare({
        actionRoot: ws1,
        binDir: bin1,
        runnerTemp: tmp1,
        nodeVersion: "24",
        pythonVersion: "3.12",
      });
      expect(customVerRes.status).toBe(0);
      expect(customVerRes.outputs["setup-node"]).toBe("true");
      expect(customVerRes.outputs["setup-python"]).toBe("true");
      expect(customVerRes.outputs["install-deps"]).toBe("true");

      // Unsupported <22 / <3.11 versions fail closed with exit 2
      expect(
        runPrepare({
          actionRoot: ws1,
          binDir: bin1,
          runnerTemp: tmp1,
          nodeVersion: "20",
        }).status,
      ).toBe(2);
      expect(
        runPrepare({
          actionRoot: ws1,
          binDir: bin1,
          runnerTemp: tmp1,
          pythonVersion: "3.10",
        }).status,
      ).toBe(2);

      // Bootstrap tests for Install script: uv absent, wrong version, and pinned 0.11.28
      const runInstallUvTest = (
        uvMode: "absent" | "wrong-version" | "pinned",
      ) => {
        const caseDir = makeTempDir(`uv-${uvMode}-`);
        const ws = join(caseDir, "ws");
        const bin = join(caseDir, "bin");
        const tmp = join(caseDir, "tmp");
        mkdirSync(tmp, { recursive: true });
        createStubReadyWorkspace(ws);
        writeFakeNodeAndPython(bin, { nodeVer: "22.14.0", pyVer: "3.11.9" });

        if (process.platform !== "win32") {
          const searchDirs = [
            ...(process.env["PATH"] ?? "").split(":"),
            "/bin",
            "/usr/bin",
          ].filter(Boolean);
          for (const tool of ["mkdir", "cat", "chmod", "dirname"]) {
            const hostDir = searchDirs.find((dir) =>
              existsSync(join(dir, tool)),
            );
            if (hostDir) {
              symlinkSync(join(hostDir, tool), join(bin, tool));
            }
          }
        }

        writeExecutableScript(
          bin,
          "npx",
          `#!/bin/sh
echo "NPX:$*" >> "${caseDir.replaceAll("\\", "/")}/ops.log"
exit 0
`,
        );
        if (uvMode === "wrong-version" || uvMode === "pinned") {
          const reported =
            uvMode === "pinned" ? "uv 0.11.28 (abc)" : "uv 0.4.0 (old)";
          writeExecutableScript(
            bin,
            "uv",
            `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${reported}"
  exit 0
fi
echo "PATH_UV:${reported}:$*" >> "${caseDir.replaceAll("\\", "/")}/ops.log"
exit 0
`,
          );
        }

        const res = spawnSync(bashExe, ["-s"], {
          input: installScript,
          encoding: "utf8",
          env: {
            PATH: bin,
            HOME: tmp,
            TMPDIR: tmp,
            RUNNER_TEMP: tmp,
            SKILLGUARD_ACTION_ROOT: ws.replaceAll("\\", "/"),
            INPUT_PYTHON_VERSION: "3.11",
            UV_PYTHON_DOWNLOADS: "never",
          },
        });
        const opsLog = existsSync(join(caseDir, "ops.log"))
          ? readFileSync(join(caseDir, "ops.log"), "utf8")
          : "";
        const isolatedUvLog = existsSync(
          join(tmp, "skillguard-uv-0.11.28", "bin", "uv.log"),
        )
          ? readFileSync(
              join(tmp, "skillguard-uv-0.11.28", "bin", "uv.log"),
              "utf8",
            )
          : "";
        const sysPipUsed = existsSync(join(bin, "sys_pip.log"));
        return { res, opsLog, isolatedUvLog, sysPipUsed };
      };

      const absentUv = runInstallUvTest("absent");
      expect(absentUv.res.status).toBe(0);
      expect(absentUv.sysPipUsed).toBe(false);
      expect(absentUv.isolatedUvLog).toContain("ISOLATED_UV:sync --locked");
      expect(absentUv.opsLog).toContain("NPX:--yes pnpm@9.15.0 build");

      const wrongUv = runInstallUvTest("wrong-version");
      expect(wrongUv.res.status).toBe(0);
      expect(wrongUv.sysPipUsed).toBe(false);
      expect(wrongUv.opsLog).not.toContain("PATH_UV:uv 0.4.0");
      expect(wrongUv.isolatedUvLog).toContain("ISOLATED_UV:sync --locked");

      const pinnedUv = runInstallUvTest("pinned");
      expect(pinnedUv.res.status).toBe(0);
      expect(pinnedUv.sysPipUsed).toBe(false);
      expect(pinnedUv.opsLog).toContain(
        "PATH_UV:uv 0.11.28 (abc):sync --locked",
      );
      expect(pinnedUv.isolatedUvLog).toBe("");
    },
  );

  it("executes real non-mocked subprocesses for exit 0, exit 1 findings, exit 2 missing path, and option rejection", () => {
    const cliDist = resolve(REPO_ROOT, "packages", "cli", "dist", "index.js");
    expect(existsSync(cliDist)).toBe(true);

    const tempWorkspace = makeTempDir("e2e-ws-");
    cpSync(
      resolve(REPO_ROOT, "examples", "greeting"),
      join(tempWorkspace, "greeting"),
      { recursive: true },
    );

    // 1. Clean scan on examples/greeting with single-pass terminal + SARIF + Step Summary -> exit 0
    const cleanOut = join(tempWorkspace, "clean_output.txt");
    const cleanSummary = join(tempWorkspace, "clean_summary.md");
    const cleanStdout = execFileSync(process.execPath, [RUN_MJS_PATH], {
      cwd: tempWorkspace,
      encoding: "utf8",
      env: {
        ...process.env,
        INPUT_COMMAND: "scan",
        INPUT_PATH: "greeting",
        INPUT_FORMAT: "terminal",
        INPUT_SARIF_FILE: "reports/greeting.sarif",
        INPUT_STEP_SUMMARY: "true",
        INPUT_UPLOAD_SARIF: "false",
        GITHUB_OUTPUT: cleanOut,
        GITHUB_STEP_SUMMARY: cleanSummary,
      },
    });
    expect(cleanStdout).toContain("Skills: 1; valid: 1");
    expect(parseGitHubOutput(cleanOut)).toEqual({
      "exit-code": "0",
      "sarif-file": "reports/greeting.sarif",
      "sarif-valid": "true",
      "sarif-has-results": "false",
    });
    expect(
      validateSarifFile(join(tempWorkspace, "reports", "greeting.sarif")).valid,
    ).toBe(true);
    const cleanSummaryMd = readFileSync(cleanSummary, "utf8");
    expect(cleanSummaryMd).toContain("## SkillGuard Security Scan Summary");
    expect(cleanSummaryMd).not.toContain(tempWorkspace);

    const checkStdout = execFileSync(process.execPath, [RUN_MJS_PATH], {
      cwd: tempWorkspace,
      encoding: "utf8",
      env: {
        ...process.env,
        INPUT_COMMAND: "check",
        INPUT_PATH: "greeting",
        INPUT_FORMAT: "terminal",
        INPUT_STEP_SUMMARY: "false",
      },
    });
    expect(checkStdout).toContain("Skills: 1; valid: 1");

    // 2. Scan with finding (invalid frontmatter / missing name) with --strict -> exit 1
    const badSkillDir = join(tempWorkspace, "bad-skill");
    mkdirSync(badSkillDir, { recursive: true });
    writeFileSync(
      join(badSkillDir, "SKILL.md"),
      "---\nname: wrong-folder-name\n---\n\n# Bad\n",
      "utf8",
    );
    const failOut = join(tempWorkspace, "findings_output.txt");
    const failSummary = join(tempWorkspace, "findings_summary.md");
    let findingsExit = -1;
    try {
      execFileSync(process.execPath, [RUN_MJS_PATH], {
        cwd: tempWorkspace,
        encoding: "utf8",
        env: {
          ...process.env,
          INPUT_COMMAND: "scan",
          INPUT_PATH: "bad-skill",
          INPUT_FORMAT: "terminal",
          INPUT_STRICT: "true",
          INPUT_SARIF_FILE: "reports/bad.sarif",
          INPUT_STEP_SUMMARY: "true",
          GITHUB_OUTPUT: failOut,
          GITHUB_STEP_SUMMARY: failSummary,
        },
      });
    } catch (error) {
      const err = error as { status?: number };
      findingsExit = err.status ?? -1;
    }
    expect(findingsExit).toBe(EXIT_FINDINGS);
    expect(parseGitHubOutput(failOut)).toEqual({
      "exit-code": "1",
      "sarif-file": "reports/bad.sarif",
      "sarif-valid": "true",
      "sarif-has-results": "true",
    });
    expect(readFileSync(failSummary, "utf8")).toContain("FINDINGS");

    // 3. Real missing directory and option-injection input -> exit 2
    for (const [label, badPath] of [
      ["missing", "nonexistent-skill-path-12345"],
      ["helpflag", "--help"],
    ]) {
      const outPath = join(tempWorkspace, `${label}_output.txt`);
      const sumPath = join(tempWorkspace, `${label}_summary.md`);
      let code = -1;
      try {
        execFileSync(process.execPath, [RUN_MJS_PATH], {
          cwd: tempWorkspace,
          encoding: "utf8",
          env: {
            ...process.env,
            INPUT_COMMAND: "scan",
            INPUT_PATH: badPath,
            GITHUB_OUTPUT: outPath,
            GITHUB_STEP_SUMMARY: sumPath,
          },
        });
      } catch (error) {
        const err = error as { status?: number };
        code = err.status ?? -1;
      }
      expect(code).toBe(EXIT_INVALID_ARGUMENTS);
      expect(parseGitHubOutput(outPath)["exit-code"]).toBe("2");
    }

    // 4. Real unavailable Python interpreter on scan -> exit 3
    const engOut = join(tempWorkspace, "engine_output.txt");
    let engCode = -1;
    try {
      execFileSync(process.execPath, [RUN_MJS_PATH], {
        cwd: tempWorkspace,
        encoding: "utf8",
        env: {
          ...process.env,
          SKILLGUARD_PYTHON: "nonexistent-python-binary-99999",
          INPUT_COMMAND: "scan",
          INPUT_PATH: "greeting",
          INPUT_STEP_SUMMARY: "false",
          GITHUB_OUTPUT: engOut,
        },
      });
    } catch (error) {
      const err = error as { status?: number };
      engCode = err.status ?? -1;
    }
    expect(engCode).toBe(EXIT_ENGINE_ERROR);
    expect(parseGitHubOutput(engOut)["exit-code"]).toBe("3");
  });

  it("handles malformed report JSON and formatter exceptions gracefully without process crash", () => {
    const tempDir = makeTempDir("sg-malformed-reports-");
    const summaryFile = join(tempDir, "summary.md");
    const outputFile = join(tempDir, "output.txt");
    const staleSarifFile = join(tempDir, "stale.sarif");

    // 1. Unit tests for parseValidatedCliReports & isValidFinding
    // Missing tool on check/scan
    const missingTool = JSON.stringify({ skills: [], findings: [] });
    expect(parseValidatedCliReports("check", missingTool)).toBeNull();
    expect(parseValidatedCliReports("scan", missingTool)).toBeNull();
    const missingTestFields = JSON.stringify({ passed: 1 }); // missing failed and results
    expect(parseValidatedCliReports("test", missingTestFields)).toBeNull();

    // Missing tool.name / empty tool.name
    const missingToolName = JSON.stringify({
      tool: { version: "0.1.0" },
      skills: [],
      findings: [],
    });
    expect(parseValidatedCliReports("check", missingToolName)).toBeNull();
    const emptyToolName = JSON.stringify({
      tool: { name: "   ", version: "0.1.0" },
      skills: [],
      findings: [],
    });
    expect(parseValidatedCliReports("check", emptyToolName)).toBeNull();

    // Invalid findings structure
    expect(isValidFinding(null)).toBe(false);
    expect(isValidFinding({})).toBe(false);
    expect(isValidFinding({ ruleId: 123, title: "T", severity: "high" })).toBe(
      false,
    );
    expect(isValidFinding({ ruleId: "R", title: "", severity: "high" })).toBe(
      false,
    );
    expect(isValidFinding({ ruleId: "R", title: "T", severity: "" })).toBe(
      false,
    );
    expect(
      isValidFinding({
        ruleId: "R",
        title: "T",
        severity: "high",
        path: 123,
      }),
    ).toBe(false);
    expect(
      isValidFinding({
        ruleId: "R",
        title: "T",
        severity: "high",
        line: "1",
      }),
    ).toBe(false);
    expect(
      isValidFinding({
        ruleId: "R",
        title: "T",
        severity: "high",
        column: "1",
      }),
    ).toBe(false);
    expect(isValidFinding({ ruleId: "R", title: "T", severity: "high" })).toBe(
      true,
    );

    const badFindingsJson = JSON.stringify({
      tool: { name: "skillguard", version: "0.1.0" },
      skills: [],
      findings: [{ ruleId: "R1" }], // missing title and severity
    });
    expect(parseValidatedCliReports("scan", badFindingsJson)).toBeNull();

    // Valid empty report
    const validEmptyJson = JSON.stringify({
      tool: { name: "skillguard", version: "0.1.0" },
      skills: [],
      findings: [],
    });
    const parsedEmpty = parseValidatedCliReports("check", validEmptyJson);
    expect(parsedEmpty).not.toBeNull();
    expect(parsedEmpty).toHaveLength(1);
    expect(parsedEmpty![0].findings).toEqual([]);

    // Valid report containing findings
    const validFindingsJson = JSON.stringify({
      schemaVersion: "1.0",
      tool: { name: "skillguard", version: "0.1.0" },
      ruleSetVersion: "1.0.0",
      profile: "agent-skills-current",
      complete: true,
      security: {
        filesScanned: 1,
        binaryFilesSkipped: 0,
        ruleSetVersion: "1.0.0",
        policy: { suppressed: [] },
      },
      skills: [{ path: "my-skill", name: "my-skill", valid: true }],
      findings: [
        {
          schemaVersion: "1.0",
          ruleId: "SG-SPEC-001",
          title: "Title mismatch",
          category: "spec",
          severity: "high",
          confidence: "high",
          path: "SKILL.md",
          line: 2,
          column: 1,
          message: "Title mismatch",
          evidence: { redacted: true, excerpt: "[Content omitted]" },
          remediation: "Fix the title.",
          references: [],
        },
      ],
      aiEvaluation: "disabled",
    });
    const parsedWithFindings = parseValidatedCliReports(
      "scan",
      validFindingsJson,
    );
    expect(parsedWithFindings).not.toBeNull();
    expect(parsedWithFindings![0].findings).toHaveLength(1);

    // 2. Action end-to-end execution on missing tool -> returns EXIT_INTERNAL_ERROR (4)
    writeFileSync(outputFile, "", "utf8");
    writeFileSync(summaryFile, "", "utf8");
    let stderrMissingTool = "";
    const cliMissingTool = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: missingTool,
    }));
    const resMissingTool = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      spawnFn: cliMissingTool.spawnFn,
      env: {
        INPUT_COMMAND: "check",
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStderr: (chunk: string) => {
        stderrMissingTool += chunk;
      },
    });
    expect(resMissingTool.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(stderrMissingTool).toContain("INVALID_OUTPUT");
    expect(parseGitHubOutput(outputFile)).toEqual({
      "exit-code": "4",
      "sarif-file": "",
      "sarif-valid": "false",
      "sarif-has-results": "false",
    });
    const summaryMissingTool = readFileSync(summaryFile, "utf8");
    expect(summaryMissingTool).toContain("SkillGuard Execution Failed");
    expect(summaryMissingTool).toContain("INVALID_OUTPUT");

    // 3. Action end-to-end execution on missing tool.name -> returns EXIT_INTERNAL_ERROR (4)
    writeFileSync(outputFile, "", "utf8");
    writeFileSync(summaryFile, "", "utf8");
    let stderrMissingName = "";
    const cliMissingName = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: missingToolName,
    }));
    const resMissingName = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      spawnFn: cliMissingName.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStderr: (chunk: string) => {
        stderrMissingName += chunk;
      },
    });
    expect(resMissingName.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(stderrMissingName).toContain("INVALID_OUTPUT");
    expect(parseGitHubOutput(outputFile)["exit-code"]).toBe("4");

    // 4. Action end-to-end execution on invalid findings structure -> returns EXIT_INTERNAL_ERROR (4)
    writeFileSync(outputFile, "", "utf8");
    writeFileSync(summaryFile, "", "utf8");
    let stderrBadFindings = "";
    const cliBadFindings = createFakeCliRunner(() => ({
      status: EXIT_FINDINGS,
      stdout: badFindingsJson,
    }));
    const resBadFindings = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      spawnFn: cliBadFindings.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStderr: (chunk: string) => {
        stderrBadFindings += chunk;
      },
    });
    expect(resBadFindings.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(stderrBadFindings).toContain("INVALID_OUTPUT");
    expect(parseGitHubOutput(outputFile)["exit-code"]).toBe("4");

    // 5. Action end-to-end execution when formatter throws an exception
    writeFileSync(outputFile, "", "utf8");
    writeFileSync(summaryFile, "", "utf8");
    writeFileSync(staleSarifFile, '{"stale": true}', "utf8");
    expect(existsSync(staleSarifFile)).toBe(true);

    let stderrCrash = "";
    const cliValid = createFakeCliRunner(() => ({
      status: EXIT_SUCCESS,
      stdout: validEmptyJson,
    }));
    const throwingRenderers = {
      formatCheckTerminal: () => {
        throw new Error("Deliberate terminal formatting crash");
      },
      formatCheckMarkdown: () => {
        throw new Error("Deliberate markdown formatting crash");
      },
      formatCheckSarif: () => {
        throw new Error("Deliberate SARIF formatting crash");
      },
      formatTestTerminal: () => "tests",
      formatTestMarkdown: () => "tests",
    };

    const resCrash = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      spawnFn: cliValid.spawnFn,
      cliRenderers: throwingRenderers,
      env: {
        INPUT_COMMAND: "check",
        INPUT_FORMAT: "markdown",
        INPUT_SARIF_FILE: "stale.sarif",
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStderr: (chunk: string) => {
        stderrCrash += chunk;
      },
    });

    expect(resCrash.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(stderrCrash).toContain(
      "INVALID_OUTPUT: Report formatting failed: Deliberate markdown formatting crash",
    );
    expect(parseGitHubOutput(outputFile)).toEqual({
      "exit-code": "4",
      "sarif-file": "",
      "sarif-valid": "false",
      "sarif-has-results": "false",
    });
    // Stale SARIF file was cleaned up
    expect(existsSync(staleSarifFile)).toBe(false);
    // Fallback step summary was rendered with INVALID_OUTPUT
    const summaryCrash = readFileSync(summaryFile, "utf8");
    expect(summaryCrash).toContain("## SkillGuard Execution Failed (`check`)");
    expect(summaryCrash).toContain("INVALID_OUTPUT");

    // 6. Action end-to-end execution on valid report with findings -> succeeds with findings (exit 1)
    writeFileSync(outputFile, "", "utf8");
    writeFileSync(summaryFile, "", "utf8");
    let stdoutValidWithFindings = "";
    const cliWithFindings = createFakeCliRunner(() => ({
      status: EXIT_FINDINGS,
      stdout: validFindingsJson,
    }));
    const resWithFindings = runSkillGuardAction({
      actionRoot: REPO_ROOT,
      workspaceRoot: tempDir,
      spawnFn: cliWithFindings.spawnFn,
      env: {
        INPUT_COMMAND: "scan",
        INPUT_FORMAT: "markdown",
        INPUT_SARIF_FILE: "reports/valid.sarif",
        INPUT_STEP_SUMMARY: "true",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      writeStdout: (chunk: string) => {
        stdoutValidWithFindings += chunk;
      },
    });
    expect(resWithFindings.exitCode).toBe(EXIT_FINDINGS);
    expect(stdoutValidWithFindings).toContain(
      "# SkillGuard Security Scan Report",
    );
    expect(stdoutValidWithFindings).toContain("SG-SPEC-001");
    expect(parseGitHubOutput(outputFile)["exit-code"]).toBe("1");
    expect(parseGitHubOutput(outputFile)["sarif-valid"]).toBe("true");
    expect(parseGitHubOutput(outputFile)["sarif-has-results"]).toBe("true");
  });

  it(
    "executes real unmocked command: 'test' with regex worker and validates exit code propagation and cleanup",
    { timeout: 30_000 },
    () => {
      const tempDir = makeTempDir("sg-action-real-test-");
      const greetingSrc = resolve(REPO_ROOT, "examples", "greeting");
      const greetingDest = join(tempDir, "greeting");
      cpSync(greetingSrc, greetingDest, { recursive: true });

      // 1. Passing tests in examples/greeting (exercises regex-worker.mjs)
      const passOut = join(tempDir, "pass_output.txt");
      const passSum = join(tempDir, "pass_summary.md");
      let passStdout = "";
      let passStderr = "";

      const passResult = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: tempDir,
        env: {
          INPUT_COMMAND: "test",
          INPUT_PATH: "greeting",
          INPUT_FORMAT: "terminal",
          INPUT_STEP_SUMMARY: "true",
          GITHUB_OUTPUT: passOut,
          GITHUB_STEP_SUMMARY: passSum,
        },
        writeStdout: (chunk: string) => {
          passStdout += chunk;
        },
        writeStderr: (chunk: string) => {
          passStderr += chunk;
        },
      });

      expect(passResult.exitCode).toBe(EXIT_SUCCESS);
      expect(passStdout).toContain(
        "Recorded fixture tests: 2 passed, 0 failed",
      );
      expect(passStderr).toBe("");
      expect(parseGitHubOutput(passOut)).toEqual({
        "exit-code": "0",
        "sarif-file": "",
        "sarif-valid": "false",
        "sarif-has-results": "false",
      });

      const passSummary = readFileSync(passSum, "utf8");
      expect(passSummary).toContain("## SkillGuard Fixture Test Summary");
      expect(passSummary).toContain("- **Result:** PASS (exit code `0`)");
      expect(passSummary).toContain("- **Passed:** 2");
      expect(passSummary).toContain("- **Failed:** 0");
      expect(passSummary).not.toContain(tempDir);

      // 2. Failing fixture tests -> exit 1 propagation
      const failSkillDir = join(tempDir, "failing-skill");
      mkdirSync(failSkillDir, { recursive: true });
      writeFileSync(
        join(failSkillDir, "SKILL.md"),
        "---\nname: failing-skill\ndescription: A test skill that fails fixtures.\n---\n# Failing Skill\n",
        "utf8",
      );
      writeFileSync(
        join(failSkillDir, "skillguard.tests.yaml"),
        [
          "version: 1",
          "tests:",
          "  - id: failing-assertion",
          "    group: smoke",
          "    skill: .",
          "    description: Deliberately failing test assertion.",
          "    input:",
          "      prompt: Say hello.",
          "    output: 'Actual greeting.'",
          "    assertions:",
          "      - type: contains",
          "        value: 'Expected mismatching text'",
        ].join("\n"),
        "utf8",
      );

      const failOut = join(tempDir, "fail_output.txt");
      const failSum = join(tempDir, "fail_summary.md");
      let failStdout = "";
      let failStderr = "";

      const failResult = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: tempDir,
        env: {
          INPUT_COMMAND: "test",
          INPUT_PATH: "failing-skill",
          INPUT_FORMAT: "terminal",
          INPUT_STEP_SUMMARY: "true",
          GITHUB_OUTPUT: failOut,
          GITHUB_STEP_SUMMARY: failSum,
        },
        writeStdout: (chunk: string) => {
          failStdout += chunk;
        },
        writeStderr: (chunk: string) => {
          failStderr += chunk;
        },
      });

      expect(failResult.exitCode).toBe(EXIT_FINDINGS);
      expect(failStderr).toBe("");
      expect(failStdout).toContain(
        "Recorded fixture tests: 0 passed, 1 failed",
      );
      expect(failStdout).toContain(
        "failing-assertion: contains assertion failed.",
      );
      expect(parseGitHubOutput(failOut)).toEqual({
        "exit-code": "1",
        "sarif-file": "",
        "sarif-valid": "false",
        "sarif-has-results": "false",
      });

      const failSummary = readFileSync(failSum, "utf8");
      expect(failSummary).toContain("## SkillGuard Fixture Test Summary");
      expect(failSummary).toContain("- **Result:** FAIL (exit code `1`)");
      expect(failSummary).toContain("- **Passed:** 0");
      expect(failSummary).toContain("- **Failed:** 1");
      expect(failSummary).toContain("failing-assertion");

      // Verify temp files created inside tempDir exist and will be cleaned up
      expect(existsSync(passOut)).toBe(true);
      expect(existsSync(failOut)).toBe(true);
    },
  );

  it(
    "verifies finding-level single-pass equivalence between direct CLI and action for terminal, markdown, and sarif",
    { timeout: 30_000 },
    () => {
      const tempDir = makeTempDir("sg-finding-equiv-");
      const mismatchDir = join(tempDir, "mismatch-skill");
      mkdirSync(mismatchDir, { recursive: true });
      writeFileSync(
        join(mismatchDir, "SKILL.md"),
        "---\nname: different-skill-name\n---\n# Mismatch Skill\n",
        "utf8",
      );

      const pythonExe = resolveActionPython({ actionRoot: REPO_ROOT });
      expect(pythonExe).toBeTruthy();
      const cliEntry = resolve(
        REPO_ROOT,
        "packages",
        "cli",
        "dist",
        "index.js",
      );

      for (const fmt of ["terminal", "markdown", "sarif"] as const) {
        // 1. Direct CLI execution
        const direct = spawnSync(
          process.execPath,
          [
            cliEntry,
            "scan",
            "--format",
            fmt,
            "--strict",
            "--no-color",
            "--python",
            pythonExe,
            "--",
            "mismatch-skill",
          ],
          {
            cwd: tempDir,
            encoding: "utf8",
          },
        );

        // 2. Action runner execution
        let actionStdout = "";
        let actionStderr = "";
        const actionResult = runSkillGuardAction({
          actionRoot: REPO_ROOT,
          workspaceRoot: tempDir,
          env: {
            INPUT_COMMAND: "scan",
            INPUT_PATH: "mismatch-skill",
            INPUT_FORMAT: fmt,
            INPUT_STRICT: "true",
            INPUT_NO_COLOR: "true",
            INPUT_STEP_SUMMARY: "false",
            SKILLGUARD_PYTHON: pythonExe,
          },
          writeStdout: (chunk: string) => {
            actionStdout += chunk;
          },
          writeStderr: (chunk: string) => {
            actionStderr += chunk;
          },
        });

        // 3. Equivalence assertions
        expect(actionResult.exitCode).toBe(EXIT_FINDINGS);
        expect(actionStderr).toBe("");
        expect(actionResult.exitCode).toBe(direct.status);

        if (fmt === "terminal") {
          expect(actionStdout.trim()).toBe(direct.stdout.trim());
          expect(actionStdout).toContain("SG-SPEC-003");
          expect(actionStdout).toContain("high");
          expect(actionStdout).toContain("SKILL.md:2:1");
        } else if (fmt === "markdown") {
          expect(actionStdout.trim()).toBe(direct.stdout.trim());
          expect(actionStdout).toContain("# SkillGuard Security Scan Report");
          expect(actionStdout).toContain("SG-SPEC-003");
          expect(actionStdout).toContain("SKILL.md:2:1");
        } else if (fmt === "sarif") {
          const directDoc = JSON.parse(direct.stdout);
          const actionDoc = JSON.parse(actionStdout);

          expect(actionDoc.version).toBe(directDoc.version);
          expect(actionDoc.$schema).toBe(directDoc.$schema);

          const directRules = directDoc.runs[0].tool.driver.rules.map(
            (r: { id: string; defaultConfiguration?: { level?: string } }) => ({
              id: r.id,
              level: r.defaultConfiguration?.level,
            }),
          );
          const actionRules = actionDoc.runs[0].tool.driver.rules.map(
            (r: { id: string; defaultConfiguration?: { level?: string } }) => ({
              id: r.id,
              level: r.defaultConfiguration?.level,
            }),
          );
          expect(actionRules).toEqual(directRules);

          interface SarifResultShape {
            ruleId: string;
            level: string;
            uri?: string;
            line?: number;
          }
          const extractResults = (doc: {
            runs: Array<{
              results: Array<{
                ruleId: string;
                level: string;
                locations?: Array<{
                  physicalLocation?: {
                    artifactLocation?: { uri?: string };
                    region?: { startLine?: number };
                  };
                }>;
              }>;
            }>;
          }): SarifResultShape[] =>
            doc.runs[0].results.map((r) => ({
              ruleId: r.ruleId,
              level: r.level,
              uri: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
              line: r.locations?.[0]?.physicalLocation?.region?.startLine,
            }));

          const directResults = extractResults(directDoc);
          const actionResults = extractResults(actionDoc);

          expect(actionResults).toEqual(directResults);
          expect(actionResults.length).toBeGreaterThan(0);
          expect(actionResults.some((r) => r.ruleId === "SG-SPEC-003")).toBe(
            true,
          );
        }
      }
    },
  );

  describe("deterministic dogfooding fixtures and security controls", () => {
    const pythonExe = resolveActionPython({ actionRoot: REPO_ROOT });

    it("runs check on valid-skill fixture yielding exit 0 and clean SARIF", () => {
      const tempDir = makeTempDir("sg-dogfood-valid-");
      cpSync(
        resolve(REPO_ROOT, "tests/fixtures/dogfooding/valid-skill"),
        join(tempDir, "valid-skill"),
        { recursive: true },
      );
      const githubOutput = join(tempDir, "github_output.txt");
      writeFileSync(githubOutput, "", "utf8");

      let actionStdout = "";
      let actionStderr = "";
      const result = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: tempDir,
        env: {
          INPUT_COMMAND: "check",
          INPUT_PATH: "valid-skill",
          INPUT_FORMAT: "sarif",
          INPUT_SARIF_FILE: "results.sarif",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          GITHUB_OUTPUT: githubOutput,
        },
        writeStdout: (chunk: string) => {
          actionStdout += chunk;
        },
        writeStderr: (chunk: string) => {
          actionStderr += chunk;
        },
      });

      expect(result.exitCode).toBe(EXIT_SUCCESS);
      expect(actionStderr).toBe("");
      expect(actionStdout).toBeTruthy();
      const outputPath = join(tempDir, "results.sarif");
      expect(existsSync(outputPath)).toBe(true);

      const sarifJson = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(sarifJson.version).toBe("2.1.0");
      expect(sarifJson.runs[0].results).toHaveLength(0);

      const outputs = readFileSync(githubOutput, "utf8");
      expect(outputs).toContain("exit-code=0");
      expect(outputs).toContain("sarif-valid=true");
      expect(outputs).toContain("sarif-has-results=false");
    });

    it("runs check on invalid-spec fixture yielding exit 1 and finding SARIF", () => {
      const tempDir = makeTempDir("sg-dogfood-invalid-");
      cpSync(
        resolve(REPO_ROOT, "tests/fixtures/dogfooding/invalid-spec"),
        join(tempDir, "invalid-spec"),
        { recursive: true },
      );
      const githubOutput = join(tempDir, "github_output.txt");
      writeFileSync(githubOutput, "", "utf8");

      let actionStdout = "";
      let actionStderr = "";
      const result = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: tempDir,
        env: {
          INPUT_COMMAND: "check",
          INPUT_PATH: "invalid-spec",
          INPUT_FORMAT: "sarif",
          INPUT_SARIF_FILE: "results.sarif",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          GITHUB_OUTPUT: githubOutput,
        },
        writeStdout: (chunk: string) => {
          actionStdout += chunk;
        },
        writeStderr: (chunk: string) => {
          actionStderr += chunk;
        },
      });

      expect(result.exitCode).toBe(EXIT_FINDINGS);
      expect(actionStderr).toBe("");
      expect(actionStdout).toBeTruthy();
      const outputPath = join(tempDir, "results.sarif");
      expect(existsSync(outputPath)).toBe(true);

      const sarifJson = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(sarifJson.version).toBe("2.1.0");
      expect(sarifJson.runs[0].results.length).toBeGreaterThan(0);
      expect(
        sarifJson.runs[0].results.some(
          (r: { ruleId: string }) => r.ruleId === "SG-REF-001",
        ),
      ).toBe(true);

      const outputs = readFileSync(githubOutput, "utf8");
      expect(outputs).toContain("exit-code=1");
      expect(outputs).toContain("sarif-valid=true");
      expect(outputs).toContain("sarif-has-results=true");
    });

    it("runs scan on sec-high fixture yielding exit 1 for high severity finding", () => {
      const tempDir = makeTempDir("sg-dogfood-sechigh-");
      const githubOutput = join(tempDir, "github_output.txt");
      writeFileSync(githubOutput, "", "utf8");

      let actionStdout = "";
      const result = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: REPO_ROOT,
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: "tests/fixtures/dogfooding/sec-high",
          INPUT_FORMAT: "terminal",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          GITHUB_OUTPUT: githubOutput,
          SKILLGUARD_PYTHON: pythonExe,
        },
        writeStdout: (chunk: string) => {
          actionStdout += chunk;
        },
      });

      expect(result.exitCode).toBe(EXIT_FINDINGS);
      expect(actionStdout).toContain("SG-SEC-010");
      expect(actionStdout).toContain("Remote download piped to a shell");

      const outputs = readFileSync(githubOutput, "utf8");
      expect(outputs).toContain("exit-code=1");
    });

    it("runs scan on sec-medium fixture verifying threshold gating (exit 0 vs exit 1)", () => {
      // 1. Default threshold (high) -> exit code 0
      let stdoutDefault = "";
      const resultDefault = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: REPO_ROOT,
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: "tests/fixtures/dogfooding/sec-medium",
          INPUT_FORMAT: "terminal",
          INPUT_SEVERITY_THRESHOLD: "high",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          SKILLGUARD_PYTHON: pythonExe,
        },
        writeStdout: (chunk: string) => {
          stdoutDefault += chunk;
        },
      });
      expect(resultDefault.exitCode).toBe(EXIT_SUCCESS);
      expect(stdoutDefault).toContain("SG-SEC-009");

      // 2. Threshold medium -> exit code 1
      let stdoutMed = "";
      const resultMed = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: REPO_ROOT,
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: "tests/fixtures/dogfooding/sec-medium",
          INPUT_FORMAT: "terminal",
          INPUT_SEVERITY_THRESHOLD: "medium",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          SKILLGUARD_PYTHON: pythonExe,
        },
        writeStdout: (chunk: string) => {
          stdoutMed += chunk;
        },
      });
      expect(resultMed.exitCode).toBe(EXIT_FINDINGS);
      expect(stdoutMed).toContain("SG-SEC-009");

      // 3. Strict mode -> exit code 1
      let stdoutStrict = "";
      const resultStrict = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: REPO_ROOT,
        env: {
          INPUT_COMMAND: "scan",
          INPUT_PATH: "tests/fixtures/dogfooding/sec-medium",
          INPUT_FORMAT: "terminal",
          INPUT_STRICT: "true",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          SKILLGUARD_PYTHON: pythonExe,
        },
        writeStdout: (chunk: string) => {
          stdoutStrict += chunk;
        },
      });
      expect(resultStrict.exitCode).toBe(EXIT_FINDINGS);
      expect(stdoutStrict).toContain("SG-SEC-009");
    });

    it("runs test on failing-tests fixture yielding exit 1", () => {
      const tempDir = makeTempDir("sg-dogfood-failtest-");
      const githubOutput = join(tempDir, "github_output.txt");
      writeFileSync(githubOutput, "", "utf8");

      let actionStdout = "";
      const result = runSkillGuardAction({
        actionRoot: REPO_ROOT,
        workspaceRoot: REPO_ROOT,
        env: {
          INPUT_COMMAND: "test",
          INPUT_PATH: "tests/fixtures/dogfooding/failing-tests",
          INPUT_FORMAT: "terminal",
          INPUT_NO_COLOR: "true",
          INPUT_STEP_SUMMARY: "false",
          GITHUB_OUTPUT: githubOutput,
        },
        writeStdout: (chunk: string) => {
          actionStdout += chunk;
        },
      });

      expect(result.exitCode).toBe(EXIT_FINDINGS);
      expect(actionStdout).toContain(
        "failing-assertion: contains assertion failed",
      );

      const outputs = readFileSync(githubOutput, "utf8");
      expect(outputs).toContain("exit-code=1");
    });

    it("enforces complete OASIS SARIF 2.1.0 JSON Schema offline across valid and malformed inputs", () => {
      const tempDir = makeTempDir("sg-sarif-schema-");

      // 1. Valid clean and finding documents pass OASIS schema
      const cleanRes = validateSarifContent(EMPTY_RESULTS_SARIF_DOC);
      expect(cleanRes.valid).toBe(true);
      expect(cleanRes.hasResults).toBe(false);

      const findingRes = validateSarifContent(VALID_SARIF_DOC);
      expect(findingRes.valid).toBe(true);
      expect(findingRes.hasResults).toBe(true);

      // 2. Empty, zero-byte, and invalid JSON
      const zeroFile = join(tempDir, "empty.sarif");
      writeFileSync(zeroFile, "", "utf8");
      expect(validateSarifContent("").valid).toBe(false);
      expect(validateSarifContent("   \n\t ").valid).toBe(false);
      expect(validateSarifFile(zeroFile).valid).toBe(false);
      expect(validateSarifContent("{not-json").valid).toBe(false);

      // 3. Incorrect SARIF version
      expect(
        validateSarifContent(
          JSON.stringify({
            version: "2.0.0",
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
            runs: [{ tool: { driver: { name: "SkillGuard" } }, results: [] }],
          }),
        ).valid,
      ).toBe(false);

      // 4. Missing required properties (driver.name, runs, message.text)
      expect(
        validateSarifContent(
          JSON.stringify({
            version: "2.1.0",
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
          }),
        ).valid,
      ).toBe(false);
      expect(
        validateSarifContent(
          JSON.stringify({
            version: "2.1.0",
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
            runs: [{ tool: { driver: {} }, results: [] }],
          }),
        ).valid,
      ).toBe(false);

      // 5. Incorrect property types
      expect(
        validateSarifContent(
          JSON.stringify({
            version: 210,
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
            runs: [{ tool: { driver: { name: "SkillGuard" } }, results: [] }],
          }),
        ).valid,
      ).toBe(false);
      expect(
        validateSarifContent(
          JSON.stringify({
            version: "2.1.0",
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
            runs: [
              { tool: { driver: { name: "SkillGuard" } }, results: "bad" },
            ],
          }),
        ).valid,
      ).toBe(false);

      // 6. Invalid result structures (missing message, invalid level, bad region)
      expect(
        validateSarifContent(
          JSON.stringify({
            version: "2.1.0",
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
            runs: [
              {
                tool: { driver: { name: "SkillGuard" } },
                results: [{ ruleId: "SG-1", level: "error" }],
              },
            ],
          }),
        ).valid,
      ).toBe(false);
      expect(
        validateSarifContent(
          JSON.stringify({
            version: "2.1.0",
            $schema: "https://json.schemastore.org/sarif-2.1.0.json",
            runs: [
              {
                tool: { driver: { name: "SkillGuard" } },
                results: [
                  {
                    ruleId: "SG-1",
                    level: "fatal",
                    message: { text: "bad level" },
                  },
                ],
              },
            ],
          }),
        ).valid,
      ).toBe(false);

      // 7. Structurally plausible but schema-invalid SARIF (forbidden additionalProperties & startLine < 1)
      const extraRootProp = validateSarifContent(
        JSON.stringify({
          version: "2.1.0",
          $schema: "https://json.schemastore.org/sarif-2.1.0.json",
          runs: [{ tool: { driver: { name: "SkillGuard" } }, results: [] }],
          unexpectedExtraField: true,
        }),
      );
      expect(extraRootProp.valid).toBe(false);
      expect(extraRootProp.reason).toContain("OASIS SARIF 2.1.0");

      const zeroStartLine = validateSarifContent(
        JSON.stringify({
          version: "2.1.0",
          $schema: "https://json.schemastore.org/sarif-2.1.0.json",
          runs: [
            {
              tool: { driver: { name: "SkillGuard" } },
              results: [
                {
                  ruleId: "SG-1",
                  level: "error",
                  message: { text: "zero line" },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: "SKILL.md" },
                        region: { startLine: 0 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      expect(zeroStartLine.valid).toBe(false);
      expect(zeroStartLine.reason).toContain("OASIS SARIF 2.1.0");

      // 8. Oversized SARIF (> 10 MiB)
      expect(validateSarifContent(" ".repeat(MAX_SARIF_BYTES + 10)).valid).toBe(
        false,
      );

      // 9. Invalid schema-violating SARIF written to disk
      const badDiskFile = join(tempDir, "schema-invalid.sarif");
      writeFileSync(
        badDiskFile,
        JSON.stringify({
          version: "2.1.0",
          $schema: "https://json.schemastore.org/sarif-2.1.0.json",
          runs: [{ tool: { driver: { name: "SkillGuard" } }, results: [] }],
          bogusProperty: "nope",
        }),
        "utf8",
      );
      const badDiskCheck = validateSarifFile(badDiskFile);
      expect(badDiskCheck.valid).toBe(false);
      expect(badDiskCheck.reason).toContain("OASIS SARIF 2.1.0");
    });

    it("enforces workspace path boundaries for both path and config inputs", () => {
      const tempDir = makeTempDir("sg-path-bounds-");
      const workspace = join(tempDir, "workspace");
      const outside = join(tempDir, "outside");
      mkdirSync(join(workspace, "skills", "my cool skill"), {
        recursive: true,
      });
      mkdirSync(join(workspace, "nested", "deep", "skill"), {
        recursive: true,
      });
      mkdirSync(join(workspace, "configs"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret-skill.md"), "# outside", "utf8");
      writeFileSync(join(outside, "evil.json"), "{}", "utf8");

      // Valid relative, nested, and space-containing paths succeed
      expect(
        validateSafeCliPathInput("nested/deep/skill", "path", workspace),
      ).toBe("nested/deep/skill");
      expect(
        validateSafeCliPathInput(
          "skills/my cool skill/SKILL.md",
          "path",
          workspace,
        ),
      ).toBe("skills/my cool skill/SKILL.md");
      expect(
        validateSafeCliPathInput("configs/my config.json", "config", workspace),
      ).toBe("configs/my config.json");

      // ../ traversal rejected for both path and config
      for (const traversal of [
        "../outside",
        "nested/../../outside",
        "nested/../nested/deep/skill",
      ]) {
        expect(() =>
          validateSafeCliPathInput(traversal, "path", workspace),
        ).toThrow(ActionInputError);
        expect(() =>
          validateSafeCliPathInput(traversal, "config", workspace),
        ).toThrow(ActionInputError);
      }

      // External absolute paths rejected
      for (const extAbs of [outside, "/etc/passwd", "/tmp/outside-skill"]) {
        expect(() =>
          parseActionInputs({ INPUT_PATH: extAbs }, workspace, "linux"),
        ).toThrow(ActionInputError);
        expect(() =>
          parseActionInputs({ INPUT_CONFIG: extAbs }, workspace, "linux"),
        ).toThrow(ActionInputError);
      }

      // Windows drive paths & drive-relative paths handled/rejected outside workspace
      for (const winPath of [
        "C:\\Windows\\System32",
        "D:\\external\\skill",
        "C:relative-drive",
      ]) {
        expect(() =>
          parseActionInputs(
            { INPUT_PATH: winPath },
            "C:\\runner\\work\\repo",
            "win32",
          ),
        ).toThrow(ActionInputError);
        expect(() =>
          parseActionInputs(
            { INPUT_CONFIG: winPath },
            "C:\\runner\\work\\repo",
            "win32",
          ),
        ).toThrow(ActionInputError);
        expect(() =>
          parseActionInputs(
            { INPUT_PATH: winPath },
            "/workspace/repo",
            "linux",
          ),
        ).toThrow(ActionInputError);
      }

      // UNC paths rejected across platforms
      for (const uncPath of [
        "\\\\evil-server\\share\\skill",
        "//evil-server/share/skill",
      ]) {
        expect(() =>
          parseActionInputs(
            { INPUT_PATH: uncPath },
            "C:\\runner\\work\\repo",
            "win32",
          ),
        ).toThrow(ActionInputError);
        expect(() =>
          parseActionInputs(
            { INPUT_CONFIG: uncPath },
            "/workspace/repo",
            "linux",
          ),
        ).toThrow(ActionInputError);
      }

      // Leading-hyphen option injection rejected for both path and config
      for (const opt of ["-h", "--help", "--strict", "--config=bad.json"]) {
        expect(() => parseActionInputs({ INPUT_PATH: opt }, workspace)).toThrow(
          ActionInputError,
        );
        expect(() =>
          parseActionInputs({ INPUT_CONFIG: opt }, workspace),
        ).toThrow(ActionInputError);
      }

      // Symlink escaping workspace and dangling symlink rejected
      const escapedLink = join(workspace, "escaped-link");
      const symlinkAttempt = tryCreateSymlink(outside, escapedLink, "dir");
      if (symlinkAttempt.ok) {
        expect(() =>
          parseActionInputs({ INPUT_PATH: "escaped-link" }, workspace),
        ).toThrow(ActionInputError);
        expect(() =>
          parseActionInputs(
            { INPUT_PATH: "escaped-link/secret-skill.md" },
            workspace,
          ),
        ).toThrow(ActionInputError);
      }

      const escapedCfg = join(workspace, "escaped-config.json");
      const cfgLinkAttempt = tryCreateSymlink(
        join(outside, "evil.json"),
        escapedCfg,
        "file",
      );
      if (cfgLinkAttempt.ok) {
        expect(() =>
          parseActionInputs({ INPUT_CONFIG: "escaped-config.json" }, workspace),
        ).toThrow(ActionInputError);
      }

      const danglingLink = join(workspace, "dangling-link");
      const danglingAttempt = tryCreateSymlink(
        join(outside, "does-not-exist"),
        danglingLink,
        "file",
      );
      if (danglingAttempt.ok) {
        expect(() =>
          parseActionInputs({ INPUT_PATH: "dangling-link" }, workspace),
        ).toThrow(ActionInputError);
      }
    });

    it("parses actual workflow YAML files and verifies P0 SARIF upload isolation and P2 dogfooding coverage", () => {
      const cliRequire = createRequire(
        resolve(REPO_ROOT, "packages", "cli", "package.json"),
      );
      const { parse: parseYaml } = cliRequire("yaml") as {
        parse: (src: string) => Record<string, unknown>;
      };

      const dogfoodRaw = readFileSync(
        resolve(REPO_ROOT, ".github", "workflows", "skillguard.yml"),
        "utf8",
      );
      const exampleRaw = readFileSync(
        resolve(REPO_ROOT, "examples", "workflows", "skillguard.yml"),
        "utf8",
      );

      // Must never use pull_request_target in either workflow
      expect(dogfoodRaw).not.toContain("pull_request_target");
      expect(exampleRaw).not.toContain("pull_request_target");

      const dogfood = parseYaml(dogfoodRaw) as {
        on: Record<string, unknown>;
        permissions: Record<string, string>;
        jobs: {
          validate: {
            strategy: { matrix: { os: string[] } };
            steps: Array<{
              id?: string;
              name?: string;
              uses?: string;
              if?: string;
              run?: string;
              "continue-on-error"?: boolean;
              with?: Record<string, unknown>;
            }>;
          };
          "upload-sarif": {
            needs: string[];
            permissions: Record<string, string>;
            if: string;
            steps: Array<{
              name?: string;
              uses?: string;
              run?: string;
              with?: Record<string, unknown>;
            }>;
          };
        };
      };

      // Top-level default read-only permission
      expect(dogfood.permissions).toEqual({ contents: "read" });
      expect("pull_request" in dogfood.on).toBe(true);
      expect("push" in dogfood.on).toBe(true);

      // Validate matrix covers Linux, Windows, macOS + all P2 fixture cases
      const validateJob = dogfood.jobs.validate;
      expect(validateJob.strategy.matrix.os).toEqual([
        "ubuntu-latest",
        "windows-latest",
        "macos-latest",
      ]);

      const stepPaths = validateJob.steps
        .map((s) => `${s.with?.command ?? ""}:${s.with?.path ?? ""}`)
        .filter((s) => s !== ":");
      expect(stepPaths).toContain("check:examples/greeting");
      expect(stepPaths).toContain("scan:examples/greeting");
      expect(stepPaths).toContain("test:examples/greeting");
      expect(stepPaths).toContain(
        "check:tests/fixtures/dogfooding/valid-skill",
      );
      expect(stepPaths).toContain(
        "check:tests/fixtures/dogfooding/invalid-spec",
      );
      expect(stepPaths).toContain("scan:tests/fixtures/dogfooding/sec-high");
      expect(stepPaths).toContain("scan:tests/fixtures/dogfooding/sec-medium");
      expect(stepPaths).toContain(
        "test:tests/fixtures/dogfooding/failing-tests",
      );

      // Every step using continue-on-error MUST have an immediately following assertion checking failure & exit-code == '1'
      validateJob.steps.forEach((step, idx) => {
        if (step["continue-on-error"] === true) {
          expect(step.id).toBeTruthy();
          const nextStep = validateJob.steps[idx + 1];
          expect(nextStep?.run).toBeTruthy();
          expect(nextStep?.run).toContain('!= "1"');
          expect(nextStep?.run).toContain('!= "failure"');
        }
      });

      // Privileged upload job isolation: MUST have EXACTLY 2 steps (download-artifact + upload-sarif)
      // Reject checkout, setup, run scripts, or arbitrary third-party actions.
      const uploadJob = dogfood.jobs["upload-sarif"];
      expect(uploadJob.needs).toEqual(["validate"]);
      expect(uploadJob.permissions).toEqual({
        contents: "read",
        "security-events": "write",
      });
      expect(uploadJob.steps).toHaveLength(2);
      const [downloadStep, sarifUploadStep] = uploadJob.steps;
      expect(downloadStep?.run).toBeUndefined();
      expect(sarifUploadStep?.run).toBeUndefined();
      expect(downloadStep?.uses).toMatch(
        /^actions\/download-artifact@[0-9a-f]{40}$/,
      );
      expect(sarifUploadStep?.uses).toMatch(
        /^github\/codeql-action\/upload-sarif@[0-9a-f]{40}$/,
      );
      expect(downloadStep?.with?.name).toBe(
        "skillguard-sarif-${{ github.run_id }}-${{ github.run_attempt }}",
      );
      expect(downloadStep?.with?.path).toBe("sarif-upload");
      expect(sarifUploadStep?.with?.sarif_file).toBe(
        "sarif-upload/results-greeting.sarif",
      );

      // Parse and evaluate the ACTUAL upload-sarif.if GitHub expression from YAML (no duplicated logic)
      const evalGitHubUploadIfExpression = (
        expr: string,
        ctx: Record<string, string>,
      ): boolean => {
        const tokens =
          expr.match(/\(|\)|&&|\|\||==|!=|'[^']*'|[A-Za-z0-9_.]+/g) ?? [];
        let pos = 0;

        const parseComparison = (): boolean => {
          if (tokens[pos] === "(") {
            pos += 1;
            const inner = parseOr();
            expect(tokens[pos]).toBe(")");
            pos += 1;
            return inner;
          }
          const lhs = tokens[pos++];
          const op = tokens[pos++];
          const rhsRaw = tokens[pos++];
          const lhsVal = lhs ? (ctx[lhs] ?? "") : "";
          const rhsVal =
            rhsRaw && rhsRaw.startsWith("'") && rhsRaw.endsWith("'")
              ? rhsRaw.slice(1, -1)
              : (rhsRaw ?? "");
          if (op === "==") return lhsVal === rhsVal;
          if (op === "!=") return lhsVal !== rhsVal;
          throw new Error(`Unsupported operator in upload-sarif.if: ${op}`);
        };

        const parseAnd = (): boolean => {
          let val = parseComparison();
          while (tokens[pos] === "&&") {
            pos += 1;
            val = parseComparison() && val;
          }
          return val;
        };

        const parseOr = (): boolean => {
          let val = parseAnd();
          while (tokens[pos] === "||") {
            pos += 1;
            val = parseAnd() || val;
          }
          return val;
        };

        const result = parseOr();
        expect(pos).toBe(tokens.length);
        return result;
      };

      const uploadIfExpr = uploadJob.if.replace(/\s+/g, " ").trim();

      // 1. Fork pull request -> false
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "naveenkumar80/skillguard",
          "github.ref": "refs/pull/42/merge",
          "github.event_name": "pull_request",
          "github.event.pull_request.head.repo.full_name":
            "untrusted-fork/skillguard",
        }),
      ).toBe(false);
      // 2. Same-repository pull request -> false
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "naveenkumar80/skillguard",
          "github.ref": "refs/pull/7/merge",
          "github.event_name": "pull_request",
          "github.event.pull_request.head.repo.full_name":
            "naveenkumar80/skillguard",
        }),
      ).toBe(false);
      // 3. Trusted master push -> true
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "naveenkumar80/skillguard",
          "github.ref": "refs/heads/master",
          "github.event_name": "push",
        }),
      ).toBe(true);
      // 4. Manual workflow_dispatch on master -> true
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "naveenkumar80/skillguard",
          "github.ref": "refs/heads/master",
          "github.event_name": "workflow_dispatch",
        }),
      ).toBe(true);
      // 5. Incorrect repository condition (even on push to master) -> false
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "someone-else/skillguard",
          "github.ref": "refs/heads/master",
          "github.event_name": "push",
        }),
      ).toBe(false);
      // 6. Incorrect branch conditions (feature branch push & main/other dispatch) -> false
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "naveenkumar80/skillguard",
          "github.ref": "refs/heads/feature/phase8",
          "github.event_name": "push",
        }),
      ).toBe(false);
      expect(
        evalGitHubUploadIfExpression(uploadIfExpr, {
          "github.repository": "naveenkumar80/skillguard",
          "github.ref": "refs/heads/main",
          "github.event_name": "workflow_dispatch",
        }),
      ).toBe(false);

      // Verify example workflow follows the exact same 2-step P0 isolation model
      const exampleWf = parseYaml(exampleRaw) as {
        permissions: Record<string, string>;
        jobs: {
          "upload-security-findings": {
            permissions: Record<string, string>;
            if: string;
            steps: Array<{ uses?: string; run?: string }>;
          };
        };
      };
      expect(exampleWf.permissions).toEqual({ contents: "read" });
      const exUpload = exampleWf.jobs["upload-security-findings"];
      expect(exUpload.permissions["security-events"]).toBe("write");
      expect(exUpload.if).not.toContain("pull_request");
      expect(exUpload.if).toContain("github.event_name == 'push'");
      expect(exUpload.steps).toHaveLength(2);
      expect(exUpload.steps[0]?.run).toBeUndefined();
      expect(exUpload.steps[1]?.run).toBeUndefined();
      expect(exUpload.steps[0]?.uses).toMatch(
        /^actions\/download-artifact@[0-9a-f]{40}$/,
      );
      expect(exUpload.steps[1]?.uses).toMatch(
        /^github\/codeql-action\/upload-sarif@[0-9a-f]{40}$/,
      );
    });

    it("ensures environment sanitization strips sensitive tokens and API keys", () => {
      const contaminatedEnv = {
        PATH: process.env["PATH"] || "",
        SYSTEMROOT: process.env["SYSTEMROOT"] || "",
        GITHUB_TOKEN: "secret-token-value",
        GH_TOKEN: "secret-gh-token",
        OPENAI_API_KEY: "secret-ai-key",
        ANTHROPIC_API_KEY: "secret-anthropic-key",
        AWS_SECRET_ACCESS_KEY: "secret-aws-key",
        SKILLGUARD_PYTHON: pythonExe || "",
      };

      const sanitized = buildSanitizedCliEnv(contaminatedEnv);
      expect(sanitized["GITHUB_TOKEN"]).toBeUndefined();
      expect(sanitized["GH_TOKEN"]).toBeUndefined();
      expect(sanitized["OPENAI_API_KEY"]).toBeUndefined();
      expect(sanitized["ANTHROPIC_API_KEY"]).toBeUndefined();
      expect(sanitized["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
      expect(sanitized["NO_COLOR"]).toBe("1");
      expect(sanitized["FORCE_COLOR"]).toBe("0");
      expect(sanitized["PATH"]).toBe(contaminatedEnv.PATH);
    });
  });
});
