import { parseConfig } from "../config/config.js";
import type { Config } from "../config/config.js";
import { ScanError } from "../discovery/filesystem.js";
import { invokeEngine } from "../engine/client.js";
import type { EngineOptions } from "../engine/client.js";
import { EngineError, validateResponse } from "../engine/protocol.js";
import type { CheckContext } from "./check.js";
import type { EngineRequest, EvaluationMetadata, Finding } from "./models.js";

export interface AdvisoryResult {
  status: "disabled" | "completed" | "failed";
  findings: Finding[];
  metadata?: EvaluationMetadata;
  errorCode?: string;
}

const safeErrorCodes = new Set([
  "AI_INVALID_REQUEST",
  "AI_INPUT_LIMIT",
  "AI_BUDGET_EXCEEDED",
  "AI_API_KEY_REQUIRED",
  "AI_API_KEY_INVALID",
  "AI_TIMEOUT",
  "AI_PROVIDER_ERROR",
  "AI_INVALID_RESPONSE",
  "AI_RESPONSE_LIMIT",
  "INVALID_CONFIG",
  "INVALID_REQUEST",
  "INVALID_RESPONSE",
  "INVALID_OPTIONS",
  "ENGINE_UNAVAILABLE",
  "ENGINE_CRASH",
  "UNSUPPORTED_PROTOCOL",
  "INVALID_JSON",
  "REQUEST_TOO_LARGE",
  "OUTPUT_LIMIT",
  "TIMEOUT",
  "CANCELLED",
  "RESOURCE_LIMIT",
  "INTERNAL_ERROR",
]);

/** Caller displays the privacy/cost disclosure first. This never changes the static report. */
export async function evaluateAdvisory(
  context: CheckContext,
  config: Config,
  consent: boolean,
  options: EngineOptions = {},
): Promise<AdvisoryResult> {
  if (!config.aiEvaluation.enabled) return { status: "disabled", findings: [] };
  if (consent !== true)
    return { status: "failed", findings: [], errorCode: "CONSENT_REQUIRED" };
  try {
    const ai = parseConfig(config).aiEvaluation;
    if (ai.provider !== "openai" || ai.model === null)
      return { status: "failed", findings: [], errorCode: "INVALID_CONFIG" };
    const files = [...context.contents].map(([path, content]) => ({
      path,
      content,
    }));
    if (
      files.reduce(
        (bytes, file) => bytes + Buffer.byteLength(file.content),
        0,
      ) > ai.maxInputBytes
    )
      return { status: "failed", findings: [], errorCode: "AI_INPUT_LIMIT" };
    const request: EngineRequest = {
      protocolVersion: "1.0",
      command: "evaluate",
      files,
      evaluation: {
        ...ai,
        enabled: true,
        consent: true,
        provider: ai.provider,
        model: ai.model,
      },
    };
    const response = validateResponse(
      await invokeEngine(request, {
        ...options,
        timeoutMs: options.timeoutMs ?? ai.timeoutMs + 1000,
      }),
    );
    if (!response.ok)
      throw new EngineError(response.error.code, "Evaluation failed");
    const metadata = response.evaluation;
    const paths = new Set(files.map((file) => file.path));
    if (
      !metadata ||
      metadata.model !== ai.model ||
      metadata.estimatedCostUsd > ai.maxCostUsd ||
      metadata.attempts > ai.maxRetries + 1 ||
      response.findings.some(
        (finding) =>
          finding.category !== "ai-evaluation" ||
          !/^SG-AI-00[1-4]$/.test(finding.ruleId) ||
          !paths.has(finding.path),
      )
    )
      throw new EngineError("AI_INVALID_RESPONSE", "Invalid advisory response");
    return { status: "completed", findings: response.findings, metadata };
  } catch (error) {
    const code =
      (error instanceof EngineError || error instanceof ScanError) &&
      safeErrorCodes.has(error.code)
        ? error.code
        : "AI_FAILED";
    return { status: "failed", findings: [], errorCode: code };
  }
}
