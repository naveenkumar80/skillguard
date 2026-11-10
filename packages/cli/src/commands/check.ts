import { resolve } from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { check } from "../core/check.js";
import { scan } from "../core/scan.js";
import { crossesThreshold, severities } from "../core/models.js";
import type { Severity } from "../core/models.js";
import { ScanError } from "../discovery/filesystem.js";
import { EXIT_FINDINGS, EXIT_SUCCESS } from "../core/exit-codes.js";
import {
  formatCheckMarkdown,
  formatCheckSarif,
  formatCheckTerminal,
  formatJson,
} from "../reporting/index.js";

export function registerCheck(
  program: Command,
  mode: "check" | "scan" = "check",
  signal?: AbortSignal,
): void {
  program
    .command(`${mode} [path]`)
    .description(
      mode === "check"
        ? "Run offline format and filesystem checks; Python is not required"
        : "Run static security analysis without executing skills",
    )
    .option(
      "--config <file>",
      "Explicit configuration file; paths resolve relative to this file",
    )
    .option("--python <executable>", "Trusted Python interpreter for scan only")
    .option(
      "--format <format>",
      "terminal, json, markdown, or sarif",
      "terminal",
    )
    .option("--strict", "Fail on any deterministic finding")
    .option(
      "--severity-threshold <severity>",
      "info, low, medium, high, critical",
    )
    .option(
      "--quiet",
      "Suppress terminal output; preserve machine-readable JSON, Markdown, or SARIF",
    )
    .option(
      "--verbose",
      "Show detailed finding messages and remediation advice",
    )
    .option("--no-color", "Disable color (output is plain text by default)")
    .action(
      async (
        path: string | undefined,
        options: {
          config?: string;
          python?: string;
          format: string;
          strict?: boolean;
          severityThreshold?: string;
          quiet?: boolean;
          verbose?: boolean;
        },
      ) => {
        if (
          !["terminal", "json", "markdown", "sarif"].includes(options.format)
        ) {
          throw new ScanError(
            "INVALID_ARGUMENTS",
            `${mode === "check" ? "Check" : "Scan"} --format must be terminal, json, markdown, or sarif`,
          );
        }
        if (
          options.severityThreshold &&
          !severities.includes(options.severityThreshold as Severity)
        ) {
          throw new ScanError(
            "INVALID_ARGUMENTS",
            "Select a valid severity threshold",
          );
        }
        const { config, base } = await loadConfig(options.config);
        if (options.strict) config.strict = true;
        if (options.severityThreshold) {
          config.severityThreshold = options.severityThreshold as Severity;
        }
        const roots = path
          ? [resolve(path)]
          : config.paths.map((entry) => resolve(base, entry));
        const reports = [];
        for (const root of roots) {
          if (signal?.aborted) {
            throw new ScanError("CANCELLED", "Operation was cancelled");
          }
          reports.push(
            mode === "check"
              ? (await check(root, config)).report
              : await scan(root, config, {
                  ...(options.python ? { executable: options.python } : {}),
                  ...(signal ? { signal } : {}),
                }),
          );
        }

        if (options.format === "json") {
          console.log(formatJson(reports.length === 1 ? reports[0] : reports));
        } else if (options.format === "sarif") {
          console.log(formatCheckSarif(reports));
        } else if (options.format === "markdown") {
          console.log(formatCheckMarkdown(reports));
        } else {
          const text = formatCheckTerminal(reports, options);
          if (text) console.log(text);
        }

        process.exitCode = reports.some(
          (report) =>
            !report.complete ||
            crossesThreshold(
              report.findings,
              config.severityThreshold,
              config.strict,
            ),
        )
          ? EXIT_FINDINGS
          : EXIT_SUCCESS;
      },
    );
}
