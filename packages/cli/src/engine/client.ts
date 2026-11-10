import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { EngineRequest, EngineResponse } from "../core/models.js";
import { EngineError, validateRequest, validateResponse } from "./protocol.js";

export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const ENVIRONMENT_ALLOWLIST = new Set([
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
]);

export function engineEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  request?: EngineRequest,
): NodeJS.ProcessEnv {
  // Validate the whole request before allowing credentials across the subprocess boundary.
  const allowAI =
    request?.command === "evaluate" &&
    validateRequest(request).evaluation?.enabled === true &&
    request.evaluation.consent === true;
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) =>
        (ENVIRONMENT_ALLOWLIST.has(key.toUpperCase()) ||
          (allowAI && key === "OPENAI_API_KEY")) &&
        typeof value === "string",
    ),
  );
}
export interface EngineOptions {
  /** A trusted interpreter, not a command from scanned content. No shell expansion. */
  executable?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function invokeEngine(
  request: EngineRequest,
  options: EngineOptions = {},
): Promise<EngineResponse & { ok: true }> {
  validateRequest(request);
  const timeout = options.timeoutMs ?? 15000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) {
    throw new EngineError(
      "INVALID_OPTIONS",
      "Engine timeout must be 1–120000 milliseconds",
    );
  }
  if (options.signal?.aborted)
    throw new EngineError("CANCELLED", "Engine operation was cancelled");
  const payload = JSON.stringify(request);
  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) {
    throw new EngineError(
      "REQUEST_TOO_LARGE",
      "Engine request exceeds the 4 MiB limit",
    );
  }
  const configured =
    options.executable ?? process.env["SKILLGUARD_PYTHON"] ?? "python";
  if (!configured || configured.includes("\0"))
    throw new EngineError(
      "INVALID_OPTIONS",
      "Select a trusted Python interpreter",
    );
  // Resolve explicit relative interpreter paths before moving to a neutral working directory.
  const executable =
    configured.includes("/") || configured.includes("\\")
      ? resolve(configured)
      : configured;

  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ["-I", "-m", "skillguard_engine"], {
      shell: false,
      windowsHide: true,
      cwd: tmpdir(),
      env: engineEnvironment(process.env, request),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let diagnosticBytes = 0;
    let failure: EngineError | undefined;
    const stop = (error: EngineError): void => {
      if (failure) return;
      failure = error;
      child.kill("SIGKILL");
    };
    const abort = (): void =>
      stop(new EngineError("CANCELLED", "Engine operation was cancelled"));
    const timer = setTimeout(
      () =>
        stop(new EngineError("TIMEOUT", "Engine timed out and was terminated")),
      timeout,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    // An abort can race with subprocess creation, before the listener is attached.
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES)
        stop(
          new EngineError(
            "OUTPUT_LIMIT",
            "Engine output exceeded its size limit",
          ),
        );
      else if (!failure) chunks.push(chunk);
    });
    // Drain but never expose stderr: even a failing engine may echo sensitive input.
    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES)
        stop(
          new EngineError(
            "OUTPUT_LIMIT",
            "Engine diagnostics exceeded their size limit",
          ),
        );
    });
    child.stdin.on("error", () => {
      // EPIPE is expected on early rejection. The close handler classifies the response.
    });
    child.on("error", () => {
      failure ??= new EngineError(
        "ENGINE_UNAVAILABLE",
        "Cannot start Python engine; install the engine and select a trusted interpreter",
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) {
        reject(failure);
        return;
      }
      if (signal) {
        reject(
          new EngineError("ENGINE_CRASH", "Engine was terminated unexpectedly"),
        );
        return;
      }
      try {
        let value: unknown;
        try {
          value = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        } catch {
          throw new EngineError(
            "INVALID_JSON",
            "Engine returned malformed JSON or invalid UTF-8",
          );
        }
        const response = validateResponse(value);
        if (!response.ok)
          throw new EngineError(
            response.error.code,
            `Engine rejected the request (${response.error.code})`,
          );
        if (code !== 0)
          throw new EngineError("ENGINE_CRASH", "Engine exited unsuccessfully");
        if (!response.engine.capabilities.includes(request.command))
          throw new EngineError(
            "INVALID_RESPONSE",
            "Engine did not declare the requested capability",
          );
        const paths = new Set(request.files.map((file) => file.path));
        if (response.findings.some((finding) => !paths.has(finding.path)))
          throw new EngineError(
            "INVALID_RESPONSE",
            "Engine findings refer to files outside this request",
          );
        resolveResult(response);
      } catch (error) {
        reject(
          error instanceof EngineError
            ? error
            : new EngineError(
                "INVALID_RESPONSE",
                "Engine response could not be validated",
              ),
        );
      }
    });
    child.stdin.end(payload);
  });
}
