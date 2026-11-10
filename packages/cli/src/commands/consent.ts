import { createInterface } from "node:readline/promises";
import process from "node:process";
import type { Config } from "../config/config.js";
import { ScanError } from "../discovery/filesystem.js";

export interface ConsentResult {
  granted: boolean;
  reason?: string;
}

export type PromptFunction = (query: string) => Promise<string>;

export interface ConsentStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function requestAiConsent(
  config: Config,
  options: { aiConsent?: boolean; quiet?: boolean } = {},
  promptFn?: PromptFunction,
  streams?: ConsentStreams,
): Promise<ConsentResult> {
  const ai = config.aiEvaluation;
  if (!ai.enabled) {
    throw new ScanError(
      "INVALID_CONFIG",
      "AI evaluation is disabled in configuration. Enable 'aiEvaluation.enabled: true' in your skillguard configuration (docs/CONFIGURATION.md) and specify a supported provider and model.",
    );
  }

  // 1. Explicit CLI flag: granted without interactive prompt
  if (options.aiConsent) {
    return { granted: true };
  }

  // 2. Non-interactive environment: fail closed immediately without waiting
  if (!promptFn && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    throw new ScanError(
      "CONSENT_REQUIRED",
      "Explicit AI consent is required. In automated or non-interactive environments, pass the '--ai-consent' flag explicitly, e.g.: skillguard evaluate [path] --ai-consent",
    );
  }

  // 3. Interactive TTY: Present the transparent disclosure on stderr
  const disclosure = [
    "",
    "=== SkillGuard AI Evaluation Transparency Disclosure ===",
    "",
    "AI evaluation is an optional, advisory-only capability.",
    "Before proceeding, please review what will happen:",
    "",
    `  • Provider & Model:      ${ai.provider} (model: ${ai.model})`,
    `  • Transmitted Content:   Skill file text up to ${ai.maxInputBytes} bytes.`,
    `                           Local filesystem paths are redacted (mapped to fileIndex: 0, 1...).`,
    `  • Excluded Content:      Binary files, files exceeding size limits, unindexed resources.`,
    `  • Financial Liability:   Worst-case budget cap is $${ai.maxCostUsd} USD.`,
    `                           (Input: $${ai.inputPricePerMillion}/M tokens, Output: $${ai.outputPricePerMillion}/M tokens, Max retries: ${ai.maxRetries}).`,
    `  • Advisory Nature:       AI findings are heuristic suggestions and CANNOT certify safety`,
    `                           or modify deterministic security findings.`,
    `  • Disabling:             Keep 'aiEvaluation.enabled: false' in skillguard.config.json.`,
    "",
  ].join("\n");

  const outputStream = streams?.output ?? process.stderr;
  const inputStream = streams?.input ?? process.stdin;

  if (!options.quiet) {
    outputStream.write(disclosure);
  }

  let answer: string;
  if (promptFn) {
    answer = await promptFn(
      `Do you consent to transmitting this skill content to ${ai.provider}? [y/N]: `,
    );
  } else {
    const rl = createInterface({
      input: inputStream,
      output: outputStream,
    });
    try {
      answer = await rl.question(
        `Do you consent to transmitting this skill content to ${ai.provider}? [y/N]: `,
      );
    } finally {
      rl.close();
    }
  }

  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    return { granted: true };
  }
  return { granted: false, reason: "DECLINED_BY_USER" };
}
