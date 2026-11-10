import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { runTests } from "../testing/index.js";
import { ScanError } from "../discovery/filesystem.js";

export function registerTest(program: Command): void {
  program
    .command("test [path]")
    .description(
      "Assert supplied recorded outputs; no live agent or skill scripts run",
    )
    .option("--config <file>", "Configuration file")
    .option("--format <format>", "terminal or json", "terminal")
    .option("--quiet", "Suppress terminal output")
    .option("--no-color", "Plain output (default)")
    .action(
      async (
        path: string | undefined,
        options: { config?: string; format: string; quiet?: boolean },
      ) => {
        if (!["terminal", "json"].includes(options.format))
          throw new ScanError(
            "INVALID_ARGUMENTS",
            "Test --format must be terminal or json",
          );
        const { config, base } = await loadConfig(options.config);
        const roots = path
          ? [resolve(path)]
          : config.paths.map((entry) => resolve(base, entry));
        const reports = [];
        for (const root of roots) reports.push(await runTests(root, config));
        if (options.format === "json")
          console.log(
            JSON.stringify(
              reports.length === 1 ? reports[0] : reports,
              null,
              2,
            ),
          );
        else if (!options.quiet)
          for (const report of reports) {
            console.log(
              `Recorded fixture tests: ${report.passed} passed, ${report.failed} failed`,
            );
            for (const test of report.results)
              if (!test.passed)
                console.log(`${test.id}: ${test.failures.join("; ")}`);
            console.log(
              "Recorded outputs only; no claim about live agent behavior.",
            );
          }
        process.exitCode = reports.some((report) => report.failed > 0) ? 1 : 0;
      },
    );
}
