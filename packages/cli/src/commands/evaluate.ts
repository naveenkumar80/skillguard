import { resolve } from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { check } from "../core/check.js";
import { evaluateAdvisory } from "../core/evaluate.js";
import { identity } from "../core/identity.js";
import { ScanError } from "../discovery/filesystem.js";
import { requestAiConsent } from "./consent.js";
import type { ConsentStreams, PromptFunction } from "./consent.js";
import { EXIT_FINDINGS, EXIT_SUCCESS } from "../core/exit-codes.js";
import {
  formatEvaluateMarkdown,
  formatEvaluateSarif,
  formatEvaluateTerminal,
  formatJson,
} from "../reporting/index.js";
import type { EvaluateReport } from "../reporting/index.js";

export type EvaluateAdvisoryFn = typeof evaluateAdvisory;

export function registerEvaluate(
  program: Command,
  signal?: AbortSignal,
  promptFn?: PromptFunction,
  evaluator: EvaluateAdvisoryFn = evaluateAdvisory,
  streams?: ConsentStreams,
): void {
  program
    .command("evaluate [path]")
    .description("Run optional advisory AI evaluation on skill instructions")
    .option(
      "--config <file>",
      "Explicit configuration file; paths resolve relative to this file",
    )
    .option("--python <executable>", "Trusted Python interpreter")
    .option(
      "--format <format>",
      "terminal, json, markdown, or sarif",
      "terminal",
    )
    .option(
      "--ai-consent",
      "Explicitly grant consent to transmit skill text to the configured AI provider",
    )
    .option(
      "--quiet",
      "Suppress terminal output; preserve machine-readable JSON, Markdown, or SARIF",
    )
    .option("--verbose", "Show detailed advisory information")
    .option("--no-color", "Disable color (output is plain text by default)")
    .action(
      async (
        path: string | undefined,
        options: {
          config?: string;
          python?: string;
          format: string;
          aiConsent?: boolean;
          quiet?: boolean;
          verbose?: boolean;
        },
      ) => {
        if (
          !["terminal", "json", "markdown", "sarif"].includes(options.format)
        ) {
          throw new ScanError(
            "INVALID_ARGUMENTS",
            "Evaluate --format must be terminal, json, markdown, or sarif",
          );
        }
        const { config, base } = await loadConfig(options.config);
        const roots = path
          ? [resolve(path)]
          : config.paths.map((entry) => resolve(base, entry));

        const consentResult = await requestAiConsent(
          config,
          options,
          promptFn,
          streams,
        );
        if (!consentResult.granted) {
          if (options.format === "json" || options.format === "markdown") {
            const declinedReports: EvaluateReport[] = roots.map((root) => ({
              schemaVersion: "1.0",
              tool: { name: identity.command, version: identity.version },
              status: "disabled",
              root,
              skills: [],
              findings: [],
              errorCode: consentResult.reason,
              disclaimer:
                "AI evaluation consent declined. No skill content was sent to any provider.",
            }));
            console.log(
              options.format === "json"
                ? formatJson(
                    declinedReports.length === 1
                      ? declinedReports[0]
                      : declinedReports,
                  )
                : formatEvaluateMarkdown(declinedReports),
            );
          } else if (options.format === "sarif") {
            console.log(formatEvaluateSarif([]));
          } else if (!options.quiet) {
            console.log(
              "AI evaluation consent declined. No skill content was sent to any provider.",
            );
          }
          process.exitCode = EXIT_SUCCESS;
          return;
        }

        const reports: EvaluateReport[] = [];

        for (const root of roots) {
          if (signal?.aborted) {
            throw new ScanError("CANCELLED", "Operation was cancelled");
          }
          const context = await check(root, config);
          const evalResult = await evaluator(context, config, true, {
            ...(options.python ? { executable: options.python } : {}),
            ...(signal ? { signal } : {}),
          });
          reports.push({
            schemaVersion: "1.0",
            tool: { name: identity.command, version: identity.version },
            status: evalResult.status,
            root,
            skills: context.report.skills,
            findings: evalResult.findings,
            evaluation: evalResult.metadata,
            errorCode: evalResult.errorCode,
            disclaimer:
              "AI findings are advisory only and cannot certify safety or modify deterministic findings.",
          });
        }

        if (options.format === "json") {
          console.log(formatJson(reports.length === 1 ? reports[0] : reports));
        } else if (options.format === "sarif") {
          console.log(formatEvaluateSarif(reports));
        } else if (options.format === "markdown") {
          console.log(formatEvaluateMarkdown(reports));
        } else {
          const text = formatEvaluateTerminal(reports, options);
          if (text) console.log(text);
        }

        const failed = reports.some((r) => r.status === "failed");
        process.exitCode = failed ? EXIT_FINDINGS : EXIT_SUCCESS;
      },
    );
}
