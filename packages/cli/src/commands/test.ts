import { resolve } from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { runTests } from "../testing/index.js";
import { ScanError } from "../discovery/filesystem.js";
import { EXIT_FINDINGS, EXIT_SUCCESS } from "../core/exit-codes.js";
import {
  formatJson,
  formatTestMarkdown,
  formatTestTerminal,
} from "../reporting/index.js";

export function registerTest(program: Command): void {
  program
    .command("test [path]")
    .description(
      "Assert supplied recorded outputs; no live agent or skill scripts run",
    )
    .option(
      "--config <file>",
      "Explicit configuration file; paths resolve relative to this file",
    )
    .option("--format <format>", "terminal, json, or markdown", "terminal")
    .option(
      "--quiet",
      "Suppress terminal output; preserve machine-readable JSON or Markdown",
    )
    .option("--verbose", "Show passed test IDs as well as failures")
    .option("--no-color", "Disable color (output is plain text by default)")
    .action(
      async (
        path: string | undefined,
        options: {
          config?: string;
          format: string;
          quiet?: boolean;
          verbose?: boolean;
        },
      ) => {
        if (!["terminal", "json", "markdown"].includes(options.format)) {
          throw new ScanError(
            "INVALID_ARGUMENTS",
            "Test --format must be terminal, json, or markdown",
          );
        }
        const { config, base } = await loadConfig(options.config);
        const roots = path
          ? [resolve(path)]
          : config.paths.map((entry) => resolve(base, entry));
        const reports = [];
        for (const root of roots) {
          reports.push(await runTests(root, config));
        }

        if (options.format === "json") {
          console.log(formatJson(reports.length === 1 ? reports[0] : reports));
        } else if (options.format === "markdown") {
          console.log(formatTestMarkdown(reports));
        } else {
          const text = formatTestTerminal(reports, options);
          if (text) console.log(text);
        }

        process.exitCode = reports.some((report) => report.failed > 0)
          ? EXIT_FINDINGS
          : EXIT_SUCCESS;
      },
    );
}
