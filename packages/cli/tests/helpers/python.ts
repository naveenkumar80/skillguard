import { existsSync, statSync } from "node:fs";
import { dirname, posix, resolve, win32 } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export type ExistsFileFn = (path: string) => boolean;

export interface ResolvePythonOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  repoRoot?: string;
  isFile?: ExistsFileFn;
}

const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function defaultIsFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isFile: ExistsFileFn,
): string | undefined {
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  if (!pathValue) return undefined;
  const pathApi = platform === "win32" ? win32 : posix;
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const directories = pathValue.split(pathDelimiter).filter(Boolean);
  const hasExtension = /\.[^\\/]+$/u.test(command);
  const rawExtensions =
    platform === "win32" && !hasExtension
      ? (env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const extensions =
    platform === "win32"
      ? [...new Set(rawExtensions.flatMap((ext) => [ext.toLowerCase(), ext]))]
      : rawExtensions;

  for (const dir of directories) {
    for (const ext of extensions) {
      const candidate = pathApi.join(dir, `${command}${ext}`);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Resolves the trusted Python interpreter for integration tests without invoking a shell.
 * Order: explicit SKILLGUARD_PYTHON environment variable > repository .venv interpreter.
 */
export function resolveTestPython(options: ResolvePythonOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const isFile = options.isFile ?? defaultIsFile;
  const pathApi = platform === "win32" ? win32 : posix;

  const override = env["SKILLGUARD_PYTHON"];
  if (override !== undefined) {
    if (override.includes("\0") || override.trim().length === 0) {
      throw new Error(
        "Invalid SKILLGUARD_PYTHON environment variable: provide a non-empty trusted Python executable path or command without NUL bytes.",
      );
    }

    const looksLikePath =
      pathApi.isAbsolute(override) ||
      override.includes("/") ||
      override.includes("\\");

    if (looksLikePath) {
      const resolvedOverride = pathApi.isAbsolute(override)
        ? override
        : pathApi.resolve(repoRoot, override);
      if (!isFile(resolvedOverride)) {
        throw new Error(
          `Configured SKILLGUARD_PYTHON interpreter was not found at "${resolvedOverride}". Verify the path or unset SKILLGUARD_PYTHON to use the project virtual environment.`,
        );
      }
      return resolvedOverride;
    }

    const onPath = resolveCommandOnPath(override, env, platform, isFile);
    if (!onPath) {
      throw new Error(
        `Configured SKILLGUARD_PYTHON command "${override}" was not found on PATH. Provide a valid executable path or unset SKILLGUARD_PYTHON.`,
      );
    }
    return onPath;
  }

  const relativeVenvPath =
    platform === "win32"
      ? pathApi.join(".venv", "Scripts", "python.exe")
      : pathApi.join(".venv", "bin", "python");
  const venvPython = pathApi.resolve(repoRoot, relativeVenvPath);

  if (!isFile(venvPython)) {
    throw new Error(
      `Project virtual environment Python interpreter not found at "${venvPython}". Run "uv sync --locked" in "${repoRoot}" or set SKILLGUARD_PYTHON to a valid Python interpreter.`,
    );
  }

  return venvPython;
}
