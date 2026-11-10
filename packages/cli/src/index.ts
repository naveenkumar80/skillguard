#!/usr/bin/env node
import process from "node:process";
import { Command, CommanderError } from "commander";
import { identity } from "./core/identity.js";
import { invokeEngine } from "./engine/client.js";
import { EngineError } from "./engine/protocol.js";
import { ScanError } from "./discovery/filesystem.js";
import { registerCheck } from "./commands/check.js";
import { registerTest } from "./commands/test.js";
import { registerEvaluate } from "./commands/evaluate.js";
import type { EvaluateAdvisoryFn } from "./commands/evaluate.js";
import type { ConsentStreams, PromptFunction } from "./commands/consent.js";
import {
  EXIT_ENGINE_ERROR,
  EXIT_INTERNAL_ERROR,
  EXIT_INVALID_ARGUMENTS,
  EXIT_SUCCESS,
} from "./core/exit-codes.js";
import {
  formatDoctorMarkdown,
  formatDoctorTerminal,
  formatJson,
} from "./reporting/index.js";
import type { DoctorStatus } from "./reporting/index.js";

export function createProgram(
  signal?: AbortSignal,
  promptFn?: PromptFunction,
  evaluator?: EvaluateAdvisoryFn,
  streams?: ConsentStreams,
): Command {
  const program = new Command();
  program
    .name(identity.command)
    .description(
      "Validate, test, and security-scan AI agent skills (development build)",
    )
    .version(identity.version)
    .exitOverride();

  program
    .command("doctor")
    .description(
      "Check Node and the installed Python engine without reading skills",
    )
    .option(
      "--python <executable>",
      "Trusted Python interpreter (or SKILLGUARD_PYTHON)",
    )
    .option("--timeout <milliseconds>", "Engine deadline", "15000")
    .option("--format <format>", "terminal, json, or markdown", "terminal")
    .option(
      "--quiet",
      "Suppress terminal output; preserve machine-readable JSON or Markdown",
    )
    .option("--verbose", "Show detailed rule set version and runtime details")
    .option("--no-color", "Disable color (output is plain text by default)")
    .action(
      async (options: {
        python?: string;
        timeout: string;
        format: string;
        quiet?: boolean;
        verbose?: boolean;
      }) => {
        if (
          !["terminal", "json", "markdown"].includes(options.format) ||
          !/^\d+$/.test(options.timeout)
        ) {
          program.error(
            "Doctor requires --format terminal|json|markdown and an integer --timeout",
            { exitCode: EXIT_INVALID_ARGUMENTS },
          );
        }
        const response = await invokeEngine(
          { protocolVersion: "1.0", command: "doctor", files: [] },
          {
            ...(options.python ? { executable: options.python } : {}),
            timeoutMs: Number(options.timeout),
            ...(signal ? { signal } : {}),
          },
        );
        const status: DoctorStatus = {
          node: process.versions.node,
          engine: response.engine,
          aiEvaluation: "disabled (advisory only)",
          releaseReady: false,
        };
        if (options.format === "json") {
          console.log(formatJson(status));
        } else if (options.format === "markdown") {
          console.log(formatDoctorMarkdown(status));
        } else {
          const text = formatDoctorTerminal(status, options);
          if (text) console.log(text);
        }
      },
    );

  registerCheck(program, "check", signal);
  registerCheck(program, "scan", signal);
  registerTest(program);
  registerEvaluate(program, signal, promptFn, evaluator, streams);

  return program;
}

const cancellation = new AbortController();
process.once("SIGINT", () => cancellation.abort());
process.once("SIGTERM", () => cancellation.abort());

export const program = createProgram(cancellation.signal);

export async function runCli(
  argv: string[] = process.argv,
  signal?: AbortSignal,
  promptFn?: PromptFunction,
  evaluator?: EvaluateAdvisoryFn,
  streams?: ConsentStreams,
): Promise<number> {
  const prog = createProgram(signal, promptFn, evaluator, streams);
  try {
    await prog.parseAsync(argv);
    return typeof process.exitCode === "number"
      ? process.exitCode
      : EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode =
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
          ? EXIT_SUCCESS
          : EXIT_INVALID_ARGUMENTS;
    } else if (error instanceof EngineError) {
      console.error(`${error.code}: ${error.message}`);
      process.exitCode =
        error.code === "CANCELLED"
          ? EXIT_INTERNAL_ERROR
          : error.code === "INVALID_OPTIONS"
            ? EXIT_INVALID_ARGUMENTS
            : EXIT_ENGINE_ERROR;
    } else if (error instanceof ScanError) {
      console.error(`${error.code}: ${error.message}`);
      process.exitCode =
        error.code === "CANCELLED"
          ? EXIT_INTERNAL_ERROR
          : EXIT_INVALID_ARGUMENTS;
    } else {
      console.error(
        "INTERNAL_ERROR: Operation failed. No skill content is included in this diagnostic.",
      );
      process.exitCode = EXIT_INTERNAL_ERROR;
    }
    return typeof process.exitCode === "number"
      ? process.exitCode
      : EXIT_INTERNAL_ERROR;
  }
}

// Run when executed directly from CLI
if (
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("skillguard"))
) {
  await runCli(process.argv, cancellation.signal);
}
