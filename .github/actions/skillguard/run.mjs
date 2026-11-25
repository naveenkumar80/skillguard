import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXIT_SUCCESS = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_INVALID_ARGUMENTS = 2;
export const EXIT_ENGINE_ERROR = 3;
export const EXIT_INTERNAL_ERROR = 4;

const ALLOWED_COMMANDS = new Set(["check", "scan", "test"]);
const ALLOWED_FORMATS = new Set(["terminal", "json", "markdown", "sarif"]);
const ALLOWED_THRESHOLDS = new Set([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);
const SARIF_VERSION = "2.1.0";
export const MAX_SARIF_BYTES = 10 * 1024 * 1024;
const MAX_CLI_BUFFER_BYTES = 16 * 1024 * 1024;
const SANITIZED_ENV_KEYS = new Set([
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "SKILLGUARD_PYTHON",
]);

const DEFAULT_ACTION_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function loadDefaultCliRenderers() {
  try {
    const reportingUrl = pathToFileURL(
      resolve(
        DEFAULT_ACTION_ROOT,
        "packages",
        "cli",
        "dist",
        "reporting",
        "index.js",
      ),
    ).href;
    const mod = await import(reportingUrl);
    if (
      typeof mod.formatCheckTerminal === "function" &&
      typeof mod.formatCheckMarkdown === "function" &&
      typeof mod.formatCheckSarif === "function" &&
      typeof mod.formatTestTerminal === "function" &&
      typeof mod.formatTestMarkdown === "function"
    ) {
      return mod;
    }
    return null;
  } catch {
    return null;
  }
}

const DEFAULT_CLI_RENDERERS = await loadDefaultCliRenderers();

function loadSarifSchemaValidator() {
  const req = createRequire(
    resolve(DEFAULT_ACTION_ROOT, "packages", "cli", "package.json"),
  );
  const AjvDraft04 = req("ajv-draft-04");
  const addFormats = req("ajv-formats");
  const schemaPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "schemas",
    "sarif-schema-2.1.0.json",
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new AjvDraft04({
    allErrors: false,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);
  return { ajv, validate: ajv.compile(schema) };
}

const SARIF_SCHEMA_VALIDATOR = loadSarifSchemaValidator();

export class ActionInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ActionInputError";
  }
}

function defaultIsFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseBooleanInput(rawValue, name, defaultValue) {
  if (rawValue === undefined || rawValue === "") return defaultValue;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new ActionInputError(
    `Input "${name}" must be "true" or "false" (received "${rawValue}").`,
  );
}

function parseOptionalString(rawValue, name) {
  if (rawValue === undefined || rawValue === "") return undefined;
  if (rawValue.includes("\0")) {
    throw new ActionInputError(`Input "${name}" must not contain NUL bytes.`);
  }
  if (rawValue.trim().length === 0) {
    throw new ActionInputError(
      `Input "${name}" must not be whitespace-only when provided.`,
    );
  }
  return rawValue.trim();
}

function isWithinDirectory(
  rootDir,
  targetPath,
  pathApi = { isAbsolute, relative, sep },
) {
  const rel = pathApi.relative(rootDir, targetPath);
  return (
    rel === "" ||
    (!pathApi.isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith(`..${pathApi.sep}`))
  );
}

function getPathApiForPlatform(platform = process.platform) {
  return platform === "win32" ? win32 : posix;
}

export function validateSafeCliPathInput(
  rawValue,
  name,
  workspaceRoot = process.cwd(),
  platform = process.platform,
) {
  const parsed = parseOptionalString(rawValue, name);
  if (parsed === undefined) return undefined;
  if (/[\r\n]/.test(parsed)) {
    throw new ActionInputError(
      `Input "${name}" must not contain newline characters.`,
    );
  }
  if (parsed.startsWith("-")) {
    throw new ActionInputError(
      `Input "${name}" must not start with "-" (potential CLI option injection).`,
    );
  }
  if (parsed.startsWith("\\\\") || parsed.startsWith("//")) {
    throw new ActionInputError(
      `Input "${name}" must not use a UNC or network share path.`,
    );
  }
  if (/^[A-Za-z]:/.test(parsed)) {
    if (platform !== "win32") {
      throw new ActionInputError(
        `Input "${name}" must not use a Windows drive path.`,
      );
    }
    if (!/^[A-Za-z]:[\\/]/.test(parsed)) {
      throw new ActionInputError(
        `Input "${name}" must not use a drive-relative Windows path.`,
      );
    }
  }

  const rawSegments = parsed.split(/[\\/]+/).filter((part) => part.length > 0);
  if (rawSegments.includes("..")) {
    throw new ActionInputError(
      `Input "${name}" must not contain parent directory traversal ("..").`,
    );
  }

  const pathApi = getPathApiForPlatform(platform);
  let canonicalWorkspace = pathApi.resolve(workspaceRoot);
  let workspaceExistsOnDisk = false;
  if (platform === process.platform) {
    let rootStat;
    try {
      rootStat = lstatSync(workspaceRoot);
    } catch {
      throw new ActionInputError("Workspace root directory does not exist.");
    }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new ActionInputError(
        "Workspace root must be an accessible ordinary directory.",
      );
    }
    canonicalWorkspace = realpathSync(workspaceRoot);
    workspaceExistsOnDisk = true;
  }

  const resolvedTarget = pathApi.resolve(canonicalWorkspace, parsed);
  if (!isWithinDirectory(canonicalWorkspace, resolvedTarget, pathApi)) {
    throw new ActionInputError(
      `Input "${name}" must resolve inside the workspace directory.`,
    );
  }

  if (workspaceExistsOnDisk) {
    const rel = pathApi.relative(canonicalWorkspace, resolvedTarget);
    const segments = rel.split(pathApi.sep).filter((part) => part.length > 0);
    let current = canonicalWorkspace;
    for (const segment of segments) {
      current = pathApi.join(current, segment);
      let entryStat;
      try {
        entryStat = lstatSync(current);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? error.code
            : undefined;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EINVAL") {
          break;
        }
        throw new ActionInputError(
          `Unable to inspect "${name}" path component safely.`,
        );
      }

      if (entryStat.isSymbolicLink()) {
        let canonicalEntry;
        try {
          canonicalEntry = realpathSync(current);
        } catch {
          throw new ActionInputError(
            `Input "${name}" must not reference a broken or looping symbolic link.`,
          );
        }
        if (!isWithinDirectory(canonicalWorkspace, canonicalEntry, pathApi)) {
          throw new ActionInputError(
            `Input "${name}" symbolic link resolves outside the workspace directory.`,
          );
        }
      }
    }
  }

  return parsed;
}

/**
 * Parses and validates all GitHub Action inputs read strictly from environment variables.
 * Never evaluates shell expressions or permits the AI `evaluate` command.
 */
export function parseActionInputs(
  env = process.env,
  workspaceRoot = process.cwd(),
  platform = process.platform,
) {
  const rawCommand = env["INPUT_COMMAND"] ?? "scan";
  if (rawCommand.includes("\0")) {
    throw new ActionInputError('Input "command" must not contain NUL bytes.');
  }
  const command = rawCommand.trim() || "scan";
  if (command === "evaluate") {
    throw new ActionInputError(
      'Command "evaluate" is disabled in the SkillGuard GitHub Action; use check, scan, or test.',
    );
  }
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new ActionInputError(
      `Unsupported command "${command}". Allowed commands: check, scan, test.`,
    );
  }

  const targetPath = validateSafeCliPathInput(
    env["INPUT_PATH"],
    "path",
    workspaceRoot,
    platform,
  );
  const config = validateSafeCliPathInput(
    env["INPUT_CONFIG"],
    "config",
    workspaceRoot,
    platform,
  );

  const severityThreshold = parseOptionalString(
    env["INPUT_SEVERITY_THRESHOLD"],
    "severity-threshold",
  );
  if (severityThreshold && !ALLOWED_THRESHOLDS.has(severityThreshold)) {
    throw new ActionInputError(
      `Invalid severity-threshold "${severityThreshold}". Expected info, low, medium, high, or critical.`,
    );
  }

  const strict = parseBooleanInput(env["INPUT_STRICT"], "strict", false);
  const rawFormat = parseOptionalString(env["INPUT_FORMAT"], "format");
  const format = rawFormat ?? "terminal";
  if (!ALLOWED_FORMATS.has(format)) {
    throw new ActionInputError(
      `Invalid format "${format}". Expected terminal, json, markdown, or sarif.`,
    );
  }

  const stepSummary = parseBooleanInput(
    env["INPUT_STEP_SUMMARY"],
    "step-summary",
    true,
  );
  const uploadSarif = parseBooleanInput(
    env["INPUT_UPLOAD_SARIF"],
    "upload-sarif",
    false,
  );
  if (uploadSarif) {
    throw new ActionInputError(
      'Input "upload-sarif=true" is not permitted in the Step 1 composite action; run SARIF upload in a separately scoped trusted workflow job.',
    );
  }

  const rawSarifFile = parseOptionalString(
    env["INPUT_SARIF_FILE"],
    "sarif-file",
  );
  if (command === "test") {
    if (format === "sarif") {
      throw new ActionInputError(
        'Command "test" only supports terminal, json, or markdown formats.',
      );
    }
    if (rawSarifFile !== undefined) {
      throw new ActionInputError(
        'Input "sarif-file" is only supported for check and scan commands.',
      );
    }
    if (strict || severityThreshold !== undefined) {
      throw new ActionInputError(
        'Inputs "strict" and "severity-threshold" are only supported for check and scan commands.',
      );
    }
  }

  let sarifFile;
  if (rawSarifFile !== undefined) {
    if (/[\r\n]/.test(rawSarifFile)) {
      throw new ActionInputError(
        'Input "sarif-file" must not contain newline characters.',
      );
    }
    if (rawSarifFile.endsWith("/") || rawSarifFile.endsWith("\\")) {
      throw new ActionInputError(
        'Input "sarif-file" must name a file path, not a directory.',
      );
    }
    const resolvedRoot = resolve(workspaceRoot);
    const resolvedSarif = resolve(resolvedRoot, rawSarifFile);
    if (
      !isWithinDirectory(resolvedRoot, resolvedSarif) ||
      relative(resolvedRoot, resolvedSarif) === ""
    ) {
      throw new ActionInputError(
        'Input "sarif-file" must resolve to a file inside the workspace directory.',
      );
    }
    sarifFile = rawSarifFile;
  }

  const quiet = parseBooleanInput(env["INPUT_QUIET"], "quiet", false);
  const verbose = parseBooleanInput(env["INPUT_VERBOSE"], "verbose", false);

  return {
    command,
    path: targetPath,
    config,
    severityThreshold,
    strict,
    format,
    sarifFile,
    stepSummary,
    uploadSarif,
    quiet,
    verbose,
  };
}

/**
 * Resolves the trusted Python interpreter cross-platform without shell invocation.
 * Respects explicit `SKILLGUARD_PYTHON`; otherwise selects repository `.venv` Python.
 */
export function resolveActionPython(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const actionRoot = options.actionRoot ?? DEFAULT_ACTION_ROOT;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const isFile = options.isFile ?? defaultIsFile;
  const pathApi = platform === "win32" ? win32 : posix;

  const override = env["SKILLGUARD_PYTHON"];
  if (override !== undefined) {
    if (override.includes("\0") || override.trim().length === 0) {
      throw new ActionInputError(
        "Invalid SKILLGUARD_PYTHON environment variable: provide a non-empty interpreter path or command without NUL bytes.",
      );
    }
    const trimmed = override.trim();
    const looksLikePath =
      pathApi.isAbsolute(trimmed) ||
      trimmed.includes("/") ||
      trimmed.includes("\\");
    if (looksLikePath && !pathApi.isAbsolute(trimmed)) {
      return pathApi.resolve(workspaceRoot, trimmed);
    }
    return trimmed;
  }

  const relativeVenvPath =
    platform === "win32"
      ? pathApi.join(".venv", "Scripts", "python.exe")
      : pathApi.join(".venv", "bin", "python");
  const venvCandidate = pathApi.resolve(actionRoot, relativeVenvPath);
  if (isFile(venvCandidate)) {
    return venvCandidate;
  }
  return "python";
}

/**
 * Builds a minimal subprocess environment excluding AI keys and workflow secrets.
 */
export function buildSanitizedCliEnv(source = process.env) {
  const clean = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    const upper = key.toUpperCase();
    if (
      SANITIZED_ENV_KEYS.has(upper) &&
      upper !== "OPENAI_API_KEY" &&
      upper !== "GITHUB_TOKEN" &&
      upper !== "GH_TOKEN"
    ) {
      clean[key] = value;
    }
  }
  clean["NO_COLOR"] = "1";
  clean["FORCE_COLOR"] = "0";
  return clean;
}

/**
 * Constructs literal CLI argument arrays (never concatenated through a shell).
 */
export function buildCliArgs(cliEntry, inputs, options = {}) {
  const formatOverride = options.formatOverride ?? inputs.format;
  const quietOverride = options.quietOverride ?? inputs.quiet;
  const args = [cliEntry, inputs.command];

  if (inputs.config !== undefined) {
    if (inputs.config.startsWith("-") || /[\r\n\0]/.test(inputs.config)) {
      throw new ActionInputError(
        'Input "config" must not start with "-" or contain control characters.',
      );
    }
    args.push("--config", inputs.config);
  }
  args.push("--format", formatOverride, "--no-color");

  if (inputs.command !== "test") {
    if (options.pythonExecutable) {
      args.push("--python", options.pythonExecutable);
    }
    if (inputs.severityThreshold !== undefined) {
      args.push("--severity-threshold", inputs.severityThreshold);
    }
    if (inputs.strict) {
      args.push("--strict");
    }
  }
  if (quietOverride) {
    args.push("--quiet");
  }
  if (inputs.verbose) {
    args.push("--verbose");
  }
  if (inputs.path !== undefined) {
    if (inputs.path.startsWith("-") || /[\r\n\0]/.test(inputs.path)) {
      throw new ActionInputError(
        'Input "path" must not start with "-" or contain control characters.',
      );
    }
    args.push("--", inputs.path);
  }
  return args;
}

/**
 * Validates that raw text is a non-empty, well-formed SARIF 2.1.0 document.
 */
export function validateSarifContent(rawText) {
  if (typeof rawText !== "string") {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF content is empty or zero-byte.",
    };
  }
  if (
    rawText.length > MAX_SARIF_BYTES ||
    Buffer.byteLength(rawText, "utf8") > MAX_SARIF_BYTES
  ) {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: `SARIF content exceeds maximum allowed size (${MAX_SARIF_BYTES} bytes).`,
    };
  }
  if (rawText.trim().length === 0) {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF content is empty or zero-byte.",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF content is not valid JSON.",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF root must be a JSON object.",
    };
  }
  if (parsed.version !== SARIF_VERSION) {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: `SARIF version must be "${SARIF_VERSION}".`,
    };
  }
  if (
    typeof parsed.$schema !== "string" ||
    (!parsed.$schema.includes("sarif-2.1.0") &&
      !parsed.$schema.includes("sarif-schema-2.1.0"))
  ) {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF $schema must reference SARIF 2.1.0.",
    };
  }
  if (!Array.isArray(parsed.runs) || parsed.runs.length === 0) {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF runs must be a non-empty array.",
    };
  }

  const schemaValid = SARIF_SCHEMA_VALIDATOR.validate(parsed);
  if (!schemaValid) {
    const rawDetail = SARIF_SCHEMA_VALIDATOR.ajv.errorsText(
      SARIF_SCHEMA_VALIDATOR.validate.errors,
    );
    const safeDetail = String(rawDetail ?? "schema violation")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 200);
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: `SARIF document failed OASIS SARIF 2.1.0 schema validation: ${safeDetail}.`,
    };
  }

  let resultCount = 0;
  for (const run of parsed.runs) {
    if (!run || typeof run !== "object" || Array.isArray(run)) {
      return {
        valid: false,
        hasResults: false,
        resultCount: 0,
        reason: "Each SARIF run must be an object.",
      };
    }
    const driverName = run.tool?.driver?.name;
    if (typeof driverName !== "string" || driverName.trim().length === 0) {
      return {
        valid: false,
        hasResults: false,
        resultCount: 0,
        reason: "SARIF run.tool.driver.name is required.",
      };
    }
    if (!Array.isArray(run.results)) {
      return {
        valid: false,
        hasResults: false,
        resultCount: 0,
        reason: "SARIF run.results must be an array.",
      };
    }
    resultCount += run.results.length;
  }

  return {
    valid: true,
    hasResults: resultCount > 0,
    resultCount,
    document: parsed,
  };
}

/**
 * Validates a SARIF file on disk, rejecting zero-byte, empty, or malformed files.
 */
export function validateSarifFile(filePath) {
  try {
    const linkStat = lstatSync(filePath);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
      return {
        valid: false,
        hasResults: false,
        resultCount: 0,
        reason: "SARIF file is not an ordinary file.",
      };
    }
    if (linkStat.size === 0) {
      return {
        valid: false,
        hasResults: false,
        resultCount: 0,
        reason: "SARIF file is missing or zero bytes.",
      };
    }
    if (linkStat.size > MAX_SARIF_BYTES) {
      return {
        valid: false,
        hasResults: false,
        resultCount: 0,
        reason: `SARIF file exceeds maximum allowed size (${MAX_SARIF_BYTES} bytes).`,
      };
    }
    return validateSarifContent(readFileSync(filePath, "utf8"));
  } catch {
    return {
      valid: false,
      hasResults: false,
      resultCount: 0,
      reason: "SARIF file cannot be read.",
    };
  }
}

/**
 * Redacts absolute filesystem host paths and common token shapes from summary text.
 */
export function redactHostPaths(text, knownRoots = []) {
  if (!text) return "";
  let redacted = text;

  const normalizedEntries = knownRoots
    .filter((entry) => entry !== undefined && entry !== null)
    .flatMap((entry) => {
      if (typeof entry === "string" && entry.length > 0) {
        return [
          { path: entry, label: "<redacted-path>" },
          { path: entry.replaceAll("\\", "/"), label: "<redacted-path>" },
        ];
      }
      if (
        typeof entry === "object" &&
        typeof entry.path === "string" &&
        entry.path.length > 0
      ) {
        const label =
          typeof entry.label === "string" && entry.label.length > 0
            ? entry.label
            : "<redacted-path>";
        return [
          { path: entry.path, label },
          { path: entry.path.replaceAll("\\", "/"), label },
        ];
      }
      return [];
    });

  const seen = new Set();
  const uniqueRoots = normalizedEntries
    .filter((item) => {
      const key = `${item.path.toLowerCase()}::${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.path.length - a.path.length);

  for (const root of uniqueRoots) {
    const escaped = root.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    redacted = redacted.replace(
      new RegExp(`${escaped}(?:[\\\\/][^\\s"'\\\`<>|\\)\\]]*)?`, "gi"),
      (match) => {
        if (root.label !== "<workspace>") {
          return root.label;
        }
        const suffix = match.slice(root.path.length).replaceAll("\\", "/");
        return suffix && suffix !== "/"
          ? `<workspace>${suffix}`
          : "<workspace>";
      },
    );
  }

  redacted = redacted
    .replace(/\b[A-Za-z]:\\[^\s"'`<>|)\]]+/g, "<redacted-path>")
    .replace(/\b[A-Za-z]:\/[^\s"'`<>|)\]]+/g, "<redacted-path>")
    .replace(/\\\\[^\s"'`<>|)\]]+\\[^\s"'`<>|)\]]+/g, "<redacted-path>")
    .replace(
      /(?<![:\w])\/(?:home|Users|private|var|tmp|opt|runner)\/[^\s"'`<>|)\]]+/g,
      "<redacted-path>",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|xapp-[0-9]+-[A-Za-z0-9-]+|(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/g,
      "[REDACTED_SECRET]",
    );

  return redacted;
}

/**
 * Escapes untrusted values for safe rendering inside GFM table cells.
 */
export function escapeMarkdownCell(value, knownRoots = []) {
  const safe = redactHostPaths(String(value ?? ""), knownRoots)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
  return safe.trim();
}

/**
 * Renders an escaped, path-redacted GitHub Step Summary from SkillGuard JSON output.
 */
export function renderStepSummaryFromJson(
  command,
  rawJson,
  exitCode,
  knownRoots = [],
) {
  let data;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return renderFallbackErrorSummary(command, exitCode, "INVALID_OUTPUT");
  }

  const reports = Array.isArray(data) ? data : [data];
  const sections = [];

  for (const report of reports) {
    if (command === "test") {
      const passed = Number(report?.passed ?? 0);
      const failed = Number(report?.failed ?? 0);
      const results = Array.isArray(report?.results) ? report.results : [];
      const lines = [
        "## SkillGuard Fixture Test Summary",
        "",
        `- **Result:** ${exitCode === 0 ? "PASS" : "FAIL"} (exit code \`${exitCode}\`)`,
        `- **Passed:** ${passed}`,
        `- **Failed:** ${failed}`,
        "",
      ];
      if (results.length > 0) {
        lines.push("| Status | Test ID | Skill | Details |");
        lines.push("| :--- | :--- | :--- | :--- |");
        for (const item of results) {
          const status = item?.passed ? "PASS" : "FAIL";
          const failures = Array.isArray(item?.failures)
            ? item.failures.join("; ")
            : "";
          lines.push(
            `| **${status}** | ${escapeMarkdownCell(item?.id, knownRoots)} | ${escapeMarkdownCell(item?.skill, knownRoots)} | ${failures ? escapeMarkdownCell(failures, knownRoots) : "—"} |`,
          );
        }
        lines.push("");
      }
      lines.push(
        "> Recorded fixtures only; no live agent or skill scripts were executed.",
      );
      sections.push(lines.join("\n"));
      continue;
    }

    const findings = Array.isArray(report?.findings) ? report.findings : [];
    const skills = Array.isArray(report?.skills) ? report.skills : [];
    const heading =
      command === "scan"
        ? "## SkillGuard Security Scan Summary"
        : "## SkillGuard Check Summary";
    const lines = [
      heading,
      "",
      `- **Result:** ${exitCode === 0 ? "PASS" : "FINDINGS"} (exit code \`${exitCode}\`)`,
      `- **Status:** ${report?.complete === false ? "Incomplete" : "Complete"}`,
      `- **Skills Evaluated:** ${skills.length}`,
      `- **Total Findings:** ${findings.length}`,
      `- **AI Evaluation:** disabled`,
      "",
    ];

    if (skills.length > 0) {
      lines.push("| Skill | Name | Valid |");
      lines.push("| :--- | :--- | :---: |");
      for (const skill of skills) {
        lines.push(
          `| ${escapeMarkdownCell(skill?.path, knownRoots)} | ${escapeMarkdownCell(skill?.name ?? "unnamed", knownRoots)} | ${skill?.valid ? "Yes" : "No"} |`,
        );
      }
      lines.push("");
    }

    if (findings.length > 0) {
      lines.push("| Severity | Rule | Location | Title |");
      lines.push("| :--- | :--- | :--- | :--- |");
      for (const finding of findings) {
        const location = `${finding?.path ?? "SKILL.md"}:${Number(finding?.line ?? 1)}:${Number(finding?.column ?? 1)}`;
        lines.push(
          `| **${escapeMarkdownCell(finding?.severity, knownRoots)}** | ${escapeMarkdownCell(finding?.ruleId, knownRoots)} | ${escapeMarkdownCell(location, knownRoots)} | ${escapeMarkdownCell(finding?.title, knownRoots)} |`,
        );
      }
      lines.push("");
    } else {
      lines.push("No findings reported.", "");
    }

    lines.push("> Static analysis only; no skill scripts were executed.");
    sections.push(lines.join("\n"));
  }

  return `${sections.join("\n\n---\n\n")}\n`;
}

export function renderFallbackErrorSummary(command, exitCode, diagnosticCode) {
  const safeCommand = ALLOWED_COMMANDS.has(command) ? command : "skillguard";
  const isNonFatalSummaryGap =
    (exitCode === EXIT_SUCCESS || exitCode === EXIT_FINDINGS) &&
    diagnosticCode === "INVALID_OUTPUT";
  const descriptions = {
    [EXIT_SUCCESS]:
      "SkillGuard completed without blocking findings, but JSON output could not be parsed for the step summary.",
    [EXIT_FINDINGS]:
      "SkillGuard reported blocking findings, but JSON output could not be parsed for the step summary.",
    [EXIT_INVALID_ARGUMENTS]: "Invalid CLI arguments or configuration.",
    [EXIT_ENGINE_ERROR]:
      "Python security engine was unavailable, timed out, or returned an invalid response.",
    [EXIT_INTERNAL_ERROR]: "Execution was cancelled or failed internally.",
  };
  const heading = isNonFatalSummaryGap
    ? `## SkillGuard Step Summary Incomplete (\`${safeCommand}\`)`
    : `## SkillGuard Execution Failed (\`${safeCommand}\`)`;
  const description =
    descriptions[exitCode] ?? "SkillGuard execution failed unexpectedly.";
  const codeLine = diagnosticCode
    ? `- **Diagnostic:** \`${escapeMarkdownCell(diagnosticCode)}\`\n`
    : "";
  return [
    heading,
    "",
    `- **Exit Code:** \`${exitCode}\``,
    `${codeLine}- **Reason:** ${description}`,
    "",
    "> No raw skill content or host secrets are included in this summary.",
    "",
  ].join("\n");
}

function writeGitHubOutputs(outputFilePath, values) {
  if (!outputFilePath) return;
  const lines = [];
  for (const [key, rawValue] of Object.entries(values)) {
    const value = String(rawValue);
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw new ActionInputError(
        `GitHub output "${key}" contains forbidden newline characters.`,
      );
    }
    lines.push(`${key}=${value}`);
  }
  appendFileSync(outputFilePath, `${lines.join("\n")}\n`, "utf8");
}

function appendStepSummary(summaryFilePath, markdownText) {
  if (!summaryFilePath || !markdownText) return;
  appendFileSync(summaryFilePath, markdownText, "utf8");
}

function classifyErrorCode(stderrText, exitCode) {
  const match = String(stderrText ?? "").match(/\b([A-Z][A-Z0-9_]{2,40}):/);
  if (match?.[1]) return match[1];
  switch (exitCode) {
    case EXIT_INVALID_ARGUMENTS:
      return "INVALID_ARGUMENTS";
    case EXIT_ENGINE_ERROR:
      return "ENGINE_ERROR";
    case EXIT_INTERNAL_ERROR:
      return "INTERNAL_ERROR";
    default:
      return "ERROR";
  }
}

function normalizeExitCode(spawnResult) {
  if (spawnResult.error) {
    return EXIT_ENGINE_ERROR;
  }
  if (spawnResult.signal) {
    return EXIT_INTERNAL_ERROR;
  }
  const status = spawnResult.status;
  if (
    status === EXIT_SUCCESS ||
    status === EXIT_FINDINGS ||
    status === EXIT_INVALID_ARGUMENTS ||
    status === EXIT_ENGINE_ERROR ||
    status === EXIT_INTERNAL_ERROR
  ) {
    return status;
  }
  return EXIT_INTERNAL_ERROR;
}

function resolveSafeSarifTarget(
  workspaceRoot,
  sarifFile,
  { createParents = false } = {},
) {
  let rootStat;
  try {
    rootStat = lstatSync(workspaceRoot);
  } catch {
    throw new ActionInputError("Workspace root directory does not exist.");
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ActionInputError(
      "Workspace root must be an accessible ordinary directory.",
    );
  }
  const canonicalWorkspace = realpathSync(workspaceRoot);

  if (sarifFile.endsWith("/") || sarifFile.endsWith("\\")) {
    throw new ActionInputError(
      'Input "sarif-file" must name a file path, not a directory.',
    );
  }

  const resolvedTarget = resolve(canonicalWorkspace, sarifFile);
  if (!isWithinDirectory(canonicalWorkspace, resolvedTarget)) {
    throw new ActionInputError(
      'Input "sarif-file" escapes the canonical workspace directory.',
    );
  }
  const rel = relative(canonicalWorkspace, resolvedTarget);
  if (!rel || rel === ".") {
    throw new ActionInputError(
      'Input "sarif-file" must point to a file path, not the workspace directory.',
    );
  }

  const segments = rel.split(sep).filter((part) => part.length > 0);
  if (segments.length === 0) {
    throw new ActionInputError('Input "sarif-file" must point to a file path.');
  }
  const leafName = segments[segments.length - 1];
  if (!leafName || leafName === "." || leafName === "..") {
    throw new ActionInputError('Input "sarif-file" must point to a file path.');
  }
  const parentSegments = segments.slice(0, -1);

  let current = canonicalWorkspace;
  for (const segment of parentSegments) {
    current = join(current, segment);
    let dirStat;
    try {
      dirStat = lstatSync(current);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (code !== "ENOENT") {
        throw new ActionInputError(
          'Unable to inspect parent directory for "sarif-file".',
        );
      }
      if (!createParents) {
        return {
          exists: false,
          targetPath: resolvedTarget,
          canonicalWorkspace,
        };
      }
      try {
        mkdirSync(current);
      } catch (mkdirErr) {
        const mkdirCode =
          mkdirErr && typeof mkdirErr === "object" && "code" in mkdirErr
            ? mkdirErr.code
            : undefined;
        if (mkdirCode !== "EEXIST") {
          throw new ActionInputError(
            'Unable to create parent directory for "sarif-file".',
          );
        }
      }
      dirStat = lstatSync(current);
    }

    if (dirStat.isSymbolicLink()) {
      throw new ActionInputError(
        'Input "sarif-file" must not traverse a symbolic link or junction.',
      );
    }
    if (!dirStat.isDirectory()) {
      throw new ActionInputError(
        'Input "sarif-file" parent path component is not a directory.',
      );
    }
    const canonicalDir = realpathSync(current);
    if (!isWithinDirectory(canonicalWorkspace, canonicalDir)) {
      throw new ActionInputError(
        'Input "sarif-file" parent directory resolves outside the workspace.',
      );
    }
  }

  const canonicalParent = realpathSync(current);
  if (!isWithinDirectory(canonicalWorkspace, canonicalParent)) {
    throw new ActionInputError(
      'Input "sarif-file" parent directory resolves outside the workspace.',
    );
  }

  const safeTarget = join(canonicalParent, leafName);
  let leafStat;
  let leafExists = false;
  try {
    leafStat = lstatSync(safeTarget);
    leafExists = true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code !== "ENOENT") {
      throw new ActionInputError('Unable to inspect "sarif-file" destination.');
    }
  }

  if (leafExists && leafStat) {
    if (leafStat.isSymbolicLink()) {
      throw new ActionInputError(
        'Input "sarif-file" must not point to a symbolic link.',
      );
    }
    if (leafStat.isDirectory()) {
      throw new ActionInputError(
        'Input "sarif-file" must not point to a directory.',
      );
    }
    if (!leafStat.isFile()) {
      throw new ActionInputError(
        'Input "sarif-file" must target an ordinary file.',
      );
    }
  }

  return {
    exists: leafExists,
    targetPath: safeTarget,
    canonicalWorkspace,
  };
}

function writeSafeSarifFile(workspaceRoot, sarifFile, content) {
  const target = resolveSafeSarifTarget(workspaceRoot, sarifFile, {
    createParents: true,
  });
  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_TRUNC |
    (constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = openSync(target.targetPath, flags, 0o644);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "ELOOP" || code === "EISDIR") {
      throw new ActionInputError(
        'Input "sarif-file" must target a writable ordinary file without symlinks.',
      );
    }
    throw error;
  }
  try {
    const handleStat = fstatSync(fd);
    if (!handleStat.isFile()) {
      throw new ActionInputError(
        'Input "sarif-file" must target an ordinary file.',
      );
    }
    const postStat = lstatSync(target.targetPath);
    if (postStat.isSymbolicLink()) {
      throw new ActionInputError(
        'Input "sarif-file" must not point to a symbolic link.',
      );
    }
    writeFileSync(fd, `${content.trimEnd()}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  return target.targetPath;
}

function removeStaleSarifFile(workspaceRoot, sarifFile) {
  const target = resolveSafeSarifTarget(workspaceRoot, sarifFile, {
    createParents: false,
  });
  if (!target.exists) return;
  const currentStat = lstatSync(target.targetPath);
  if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
    throw new ActionInputError(
      'Input "sarif-file" must not point to a symbolic link or directory.',
    );
  }
  unlinkSync(target.targetPath);
}

export function isValidFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return false;
  }
  if (
    typeof finding.ruleId !== "string" ||
    finding.ruleId.trim().length === 0 ||
    typeof finding.title !== "string" ||
    finding.title.trim().length === 0 ||
    typeof finding.severity !== "string" ||
    finding.severity.trim().length === 0
  ) {
    return false;
  }
  if (
    finding.path !== undefined &&
    finding.path !== null &&
    typeof finding.path !== "string"
  ) {
    return false;
  }
  if (
    finding.line !== undefined &&
    finding.line !== null &&
    typeof finding.line !== "number"
  ) {
    return false;
  }
  if (
    finding.column !== undefined &&
    finding.column !== null &&
    typeof finding.column !== "number"
  ) {
    return false;
  }
  return true;
}

export function parseValidatedCliReports(command, rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const reports = Array.isArray(parsed) ? parsed : [parsed];
  if (reports.length === 0) {
    return null;
  }
  for (const report of reports) {
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      return null;
    }
    if (command === "test") {
      if (
        typeof report.passed !== "number" ||
        typeof report.failed !== "number" ||
        !Array.isArray(report.results)
      ) {
        return null;
      }
      for (const res of report.results) {
        if (!res || typeof res !== "object" || Array.isArray(res)) {
          return null;
        }
        if (
          typeof res.id !== "string" ||
          typeof res.passed !== "boolean" ||
          !Array.isArray(res.failures)
        ) {
          return null;
        }
      }
    } else {
      if (
        !report.tool ||
        typeof report.tool !== "object" ||
        Array.isArray(report.tool) ||
        typeof report.tool.name !== "string" ||
        report.tool.name.trim().length === 0
      ) {
        return null;
      }
      if (!Array.isArray(report.skills) || !Array.isArray(report.findings)) {
        return null;
      }
      for (const finding of report.findings) {
        if (!isValidFinding(finding)) {
          return null;
        }
      }
    }
  }
  return reports;
}

function renderPrimaryFromReports(command, format, reports, inputs, renderers) {
  if (command === "test") {
    if (format === "markdown") {
      return `${renderers.formatTestMarkdown(reports)}\n`;
    }
    const text = renderers.formatTestTerminal(reports, {
      quiet: inputs.quiet,
      verbose: inputs.verbose,
    });
    return text ? `${text}\n` : "";
  }
  if (format === "markdown") {
    return `${renderers.formatCheckMarkdown(reports)}\n`;
  }
  const text = renderers.formatCheckTerminal(reports, {
    quiet: inputs.quiet,
    verbose: inputs.verbose,
  });
  return text ? `${text}\n` : "";
}

function finalizeEarlyFailure({
  outputPath,
  summaryPath,
  stepSummary,
  command,
  exitCode,
  diagnosticCode,
}) {
  writeGitHubOutputs(outputPath, {
    "exit-code": exitCode,
    "sarif-file": "",
    "sarif-valid": "false",
    "sarif-has-results": "false",
  });
  if (stepSummary) {
    appendStepSummary(
      summaryPath,
      renderFallbackErrorSummary(command, exitCode, diagnosticCode),
    );
  }
  return {
    exitCode,
    sarifFile: "",
    sarifValid: false,
    sarifHasResults: false,
  };
}

function finalizeSarifArtifact({
  rawSarif,
  workspaceRoot,
  sarifFile,
  knownRoots,
  writeStderr,
}) {
  const checked = validateSarifContent(rawSarif);
  if (!checked.valid) {
    writeStderr(
      `INVALID_SARIF: Refusing invalid SARIF output (${checked.reason}).\n`,
    );
    return {
      ok: false,
      exitCode: EXIT_INTERNAL_ERROR,
      sarifFileOut: "",
      sarifValid: false,
      sarifHasResults: false,
      diagnosticCode: "INVALID_SARIF",
      pathUnsafe: false,
    };
  }

  let sarifValid = true;
  let sarifHasResults = checked.hasResults;
  let sarifFileOut = "";

  if (sarifFile !== undefined) {
    try {
      const targetSarifPath = writeSafeSarifFile(
        workspaceRoot,
        sarifFile,
        rawSarif,
      );
      const diskCheck = validateSarifFile(targetSarifPath);
      sarifValid = diskCheck.valid;
      sarifHasResults = diskCheck.hasResults;
      if (diskCheck.valid) {
        sarifFileOut = sarifFile;
      } else {
        writeStderr(
          `INVALID_SARIF: Written SARIF verification failed (${diskCheck.reason}).\n`,
        );
        return {
          ok: false,
          exitCode: EXIT_INTERNAL_ERROR,
          sarifFileOut: "",
          sarifValid: false,
          sarifHasResults: false,
          diagnosticCode: "INVALID_SARIF",
          pathUnsafe: false,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Cannot write validated SARIF file safely.";
      writeStderr(
        `INVALID_ARGUMENTS: ${redactHostPaths(message, knownRoots)}\n`,
      );
      return {
        ok: false,
        exitCode: EXIT_INVALID_ARGUMENTS,
        sarifFileOut: "",
        sarifValid: false,
        sarifHasResults: false,
        diagnosticCode: "INVALID_ARGUMENTS",
        pathUnsafe: true,
      };
    }
  }

  return {
    ok: true,
    exitCode: EXIT_SUCCESS,
    sarifFileOut,
    sarifValid,
    sarifHasResults,
    diagnosticCode: "",
    pathUnsafe: false,
  };
}

function cleanupStaleSarifIfNeeded({
  workspaceRoot,
  sarifFile,
  sarifFileOut,
  alreadyUnsafe,
  knownRoots,
  writeStderr,
}) {
  if (alreadyUnsafe || sarifFile === undefined || sarifFileOut !== "") {
    return null;
  }
  try {
    removeStaleSarifFile(workspaceRoot, sarifFile);
    return null;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Cannot clean stale SARIF file safely.";
    writeStderr(`INVALID_ARGUMENTS: ${redactHostPaths(message, knownRoots)}\n`);
    return EXIT_INVALID_ARGUMENTS;
  }
}

/**
 * Main testable action runner.
 */
export function runSkillGuardAction(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const actionRoot = options.actionRoot ?? DEFAULT_ACTION_ROOT;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const isFile = options.isFile ?? defaultIsFile;
  const spawnFn = options.spawnFn ?? spawnSync;
  const writeStdout =
    options.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr =
    options.writeStderr ?? ((text) => process.stderr.write(text));

  const renderers =
    "cliRenderers" in options
      ? options.cliRenderers
      : resolve(actionRoot) === DEFAULT_ACTION_ROOT
        ? DEFAULT_CLI_RENDERERS
        : null;

  const knownRoots = [
    { path: workspaceRoot, label: "<workspace>" },
    { path: resolve(workspaceRoot), label: "<workspace>" },
    { path: actionRoot, label: "<redacted-path>" },
    { path: resolve(actionRoot), label: "<redacted-path>" },
    { path: homedir(), label: "<redacted-path>" },
    { path: tmpdir(), label: "<redacted-path>" },
  ];

  const outputPath = env["GITHUB_OUTPUT"];
  const summaryPath = env["GITHUB_STEP_SUMMARY"];

  let inputs;
  try {
    inputs = parseActionInputs(env, workspaceRoot, platform);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid action input.";
    writeStderr(`INVALID_ARGUMENTS: ${redactHostPaths(message, knownRoots)}\n`);
    return finalizeEarlyFailure({
      outputPath,
      summaryPath,
      stepSummary: env["INPUT_STEP_SUMMARY"] !== "false",
      command: String(env["INPUT_COMMAND"] ?? "skillguard").trim(),
      exitCode: EXIT_INVALID_ARGUMENTS,
      diagnosticCode: "INVALID_ARGUMENTS",
    });
  }

  const cliEntry = resolve(actionRoot, "packages", "cli", "dist", "index.js");
  if (!options.spawnFn && !isFile(cliEntry)) {
    writeStderr(
      "ENGINE_UNAVAILABLE: Built SkillGuard CLI entry was not found; build @skillguard/cli first.\n",
    );
    return finalizeEarlyFailure({
      outputPath,
      summaryPath,
      stepSummary: inputs.stepSummary,
      command: inputs.command,
      exitCode: EXIT_ENGINE_ERROR,
      diagnosticCode: "CLI_NOT_BUILT",
    });
  }

  let pythonExecutable;
  if (inputs.command !== "test") {
    try {
      pythonExecutable = resolveActionPython({
        env,
        platform,
        actionRoot,
        workspaceRoot,
        isFile,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Invalid Python configuration.";
      writeStderr(
        `INVALID_ARGUMENTS: ${redactHostPaths(message, knownRoots)}\n`,
      );
      return finalizeEarlyFailure({
        outputPath,
        summaryPath,
        stepSummary: inputs.stepSummary,
        command: inputs.command,
        exitCode: EXIT_INVALID_ARGUMENTS,
        diagnosticCode: "INVALID_OPTIONS",
      });
    }
  }

  const cleanEnv = buildSanitizedCliEnv(env);
  const invokeCli = (args) =>
    spawnFn(process.execPath, args, {
      cwd: workspaceRoot,
      env: cleanEnv,
      shell: false,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: MAX_CLI_BUFFER_BYTES,
    });

  const needsSarif =
    inputs.format === "sarif" || inputs.sarifFile !== undefined;
  const wantsMultiOutput =
    (inputs.sarifFile !== undefined && inputs.format !== "sarif") ||
    (inputs.stepSummary && inputs.format !== "json");
  const useSinglePassJson = Boolean(
    renderers && (wantsMultiOutput || inputs.format === "json"),
  );

  let exitCode = EXIT_SUCCESS;
  let sarifFileOut = "";
  let sarifValid = false;
  let sarifHasResults = false;
  let sarifPathUnsafe = false;
  let failingStderr = "";
  let summaryJson;
  let fallbackSummaryOverride = "";

  if (useSinglePassJson && renderers) {
    const primaryArgs = buildCliArgs(cliEntry, inputs, {
      pythonExecutable,
      formatOverride: "json",
      quietOverride: false,
    });
    const primary = invokeCli(primaryArgs);
    exitCode = normalizeExitCode(primary);
    const primaryStdout = primary.stdout ?? "";
    const primaryStderr = primary.stderr ?? "";
    failingStderr = primaryStderr;
    if (primaryStderr) {
      writeStderr(redactHostPaths(primaryStderr, knownRoots));
    }

    if (exitCode === EXIT_SUCCESS || exitCode === EXIT_FINDINGS) {
      const reports = parseValidatedCliReports(inputs.command, primaryStdout);
      if (!reports) {
        exitCode = EXIT_INTERNAL_ERROR;
        failingStderr =
          "INVALID_OUTPUT: SkillGuard CLI returned invalid or incomplete JSON output.\n";
        writeStderr(failingStderr);
      } else {
        summaryJson = primaryStdout;
        try {
          if (inputs.format === "json") {
            if (primaryStdout) {
              writeStdout(primaryStdout);
            }
          } else if (inputs.format !== "sarif") {
            const rendered = renderPrimaryFromReports(
              inputs.command,
              inputs.format,
              reports,
              inputs,
              renderers,
            );
            if (rendered) {
              writeStdout(rendered);
            }
          }

          if (needsSarif) {
            const rawSarif = `${renderers.formatCheckSarif(reports)}\n`;
            const sarifOutcome = finalizeSarifArtifact({
              rawSarif,
              workspaceRoot,
              sarifFile: inputs.sarifFile,
              knownRoots,
              writeStderr,
            });
            if (sarifOutcome.ok) {
              sarifFileOut = sarifOutcome.sarifFileOut;
              sarifValid = sarifOutcome.sarifValid;
              sarifHasResults = sarifOutcome.sarifHasResults;
              if (inputs.format === "sarif") {
                writeStdout(rawSarif);
              }
            } else {
              sarifPathUnsafe = sarifOutcome.pathUnsafe;
              exitCode = sarifOutcome.exitCode;
              failingStderr = `${sarifOutcome.diagnosticCode}: SARIF processing failed.\n`;
            }
          }
        } catch (formatError) {
          exitCode = EXIT_INTERNAL_ERROR;
          sarifValid = false;
          sarifHasResults = false;
          sarifFileOut = "";
          const errMsg =
            formatError instanceof Error
              ? formatError.message
              : String(formatError);
          failingStderr = `INVALID_OUTPUT: Report formatting failed: ${errMsg}\n`;
          writeStderr(failingStderr);
        }
      }
    }
  } else {
    const primaryArgs = buildCliArgs(cliEntry, inputs, { pythonExecutable });
    const primary = invokeCli(primaryArgs);
    exitCode = normalizeExitCode(primary);

    const primaryStdout = primary.stdout ?? "";
    const primaryStderr = primary.stderr ?? "";
    failingStderr = primaryStderr;

    if (primaryStderr) {
      writeStderr(redactHostPaths(primaryStderr, knownRoots));
    }

    const canEmitArtifacts =
      exitCode === EXIT_SUCCESS || exitCode === EXIT_FINDINGS;

    if (canEmitArtifacts) {
      if (inputs.format === "json") {
        summaryJson = primaryStdout;
      }

      if (needsSarif) {
        let rawSarif = primaryStdout;
        let sarifExitCode = exitCode;
        let sarifRunStderr = "";
        if (inputs.format !== "sarif") {
          const sarifArgs = buildCliArgs(cliEntry, inputs, {
            pythonExecutable,
            formatOverride: "sarif",
            quietOverride: true,
          });
          const sarifRun = invokeCli(sarifArgs);
          sarifExitCode = normalizeExitCode(sarifRun);
          rawSarif = sarifRun.stdout ?? "";
          sarifRunStderr = sarifRun.stderr ?? "";
          if (sarifRunStderr) {
            writeStderr(redactHostPaths(sarifRunStderr, knownRoots));
          }
        }
        if (sarifExitCode === EXIT_SUCCESS || sarifExitCode === EXIT_FINDINGS) {
          const sarifOutcome = finalizeSarifArtifact({
            rawSarif,
            workspaceRoot,
            sarifFile: inputs.sarifFile,
            knownRoots,
            writeStderr,
          });
          if (sarifOutcome.ok) {
            sarifFileOut = sarifOutcome.sarifFileOut;
            sarifValid = sarifOutcome.sarifValid;
            sarifHasResults = sarifOutcome.sarifHasResults;
            if (inputs.format === "sarif" && primaryStdout) {
              writeStdout(primaryStdout);
            }
          } else {
            sarifPathUnsafe = sarifOutcome.pathUnsafe;
            exitCode = sarifOutcome.exitCode;
            failingStderr = `${sarifOutcome.diagnosticCode}: SARIF processing failed.\n`;
          }
        } else {
          exitCode = sarifExitCode;
          failingStderr = sarifRunStderr || primaryStderr;
        }
      } else if (primaryStdout) {
        writeStdout(primaryStdout);
      }

      if (
        inputs.stepSummary &&
        summaryJson === undefined &&
        (exitCode === EXIT_SUCCESS || exitCode === EXIT_FINDINGS)
      ) {
        const jsonArgs = buildCliArgs(cliEntry, inputs, {
          pythonExecutable,
          formatOverride: "json",
          quietOverride: true,
        });
        const jsonRun = invokeCli(jsonArgs);
        const jsonExit = normalizeExitCode(jsonRun);
        const jsonStderr = jsonRun.stderr ?? "";
        if (jsonStderr) {
          writeStderr(redactHostPaths(jsonStderr, knownRoots));
        }
        if (jsonExit === EXIT_SUCCESS || jsonExit === EXIT_FINDINGS) {
          summaryJson = jsonRun.stdout ?? "";
        } else {
          fallbackSummaryOverride = renderFallbackErrorSummary(
            inputs.command,
            jsonExit,
            classifyErrorCode(jsonStderr, jsonExit),
          );
        }
      }
    } else if (primaryStdout) {
      writeStdout(primaryStdout);
    }
  }

  const staleCleanupExit = cleanupStaleSarifIfNeeded({
    workspaceRoot,
    sarifFile: inputs.sarifFile,
    sarifFileOut,
    alreadyUnsafe: sarifPathUnsafe,
    knownRoots,
    writeStderr,
  });
  if (staleCleanupExit !== null) {
    sarifFileOut = "";
    sarifValid = false;
    sarifHasResults = false;
    if (exitCode === EXIT_SUCCESS || exitCode === EXIT_FINDINGS) {
      exitCode = staleCleanupExit;
      failingStderr = "INVALID_ARGUMENTS: Unsafe SARIF file path.\n";
    }
  }

  if (inputs.stepSummary) {
    let summaryMarkdown = fallbackSummaryOverride;
    if (!summaryMarkdown) {
      if (exitCode === EXIT_SUCCESS || exitCode === EXIT_FINDINGS) {
        try {
          summaryMarkdown = renderStepSummaryFromJson(
            inputs.command,
            summaryJson ?? "",
            exitCode,
            knownRoots,
          );
        } catch {
          summaryMarkdown = renderFallbackErrorSummary(
            inputs.command,
            exitCode,
            "INVALID_OUTPUT",
          );
        }
      } else {
        summaryMarkdown = renderFallbackErrorSummary(
          inputs.command,
          exitCode,
          classifyErrorCode(failingStderr, exitCode),
        );
      }
    }
    appendStepSummary(summaryPath, summaryMarkdown);
  }

  writeGitHubOutputs(outputPath, {
    "exit-code": exitCode,
    "sarif-file": sarifFileOut,
    "sarif-valid": sarifValid ? "true" : "false",
    "sarif-has-results": sarifHasResults ? "true" : "false",
  });

  return {
    exitCode,
    sarifFile: sarifFileOut,
    sarifValid,
    sarifHasResults,
  };
}

function main() {
  const result = runSkillGuardAction();
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
