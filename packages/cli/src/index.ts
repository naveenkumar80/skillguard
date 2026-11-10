#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { identity } from "./core/identity.js";
import { invokeEngine } from "./engine/client.js";
import { EngineError } from "./engine/protocol.js";
import { ScanError } from "./discovery/filesystem.js";
import { registerCheck } from "./commands/check.js";
import { registerTest } from "./commands/test.js";

const program = new Command();
program
  .name(identity.command)
  .description(
    "Validate, test, and security-scan AI agent skills (development build)",
  )
  .version(identity.version)
  .exitOverride();
const cancellation = new AbortController();
process.once("SIGINT", () => cancellation.abort());
process.once("SIGTERM", () => cancellation.abort());

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
  .option("--format <format>", "terminal or json", "terminal")
  .action(
    async (options: { python?: string; timeout: string; format: string }) => {
      if (
        !["terminal", "json"].includes(options.format) ||
        !/^\d+$/.test(options.timeout)
      ) {
        program.error(
          "Doctor requires --format terminal|json and an integer --timeout",
          { exitCode: 2 },
        );
      }
      const response = await invokeEngine(
        { protocolVersion: "1.0", command: "doctor", files: [] },
        {
          ...(options.python ? { executable: options.python } : {}),
          timeoutMs: Number(options.timeout),
          signal: cancellation.signal,
        },
      );
      const status = {
        node: process.versions.node,
        engine: response.engine,
        aiEvaluation: "disabled",
        releaseReady: false,
      };
      if (options.format === "json")
        console.log(JSON.stringify(status, null, 2));
      else {
        console.log(`${identity.name} ${identity.version} (development only)`);
        console.log(
          `Node ${status.node}; Python engine ${response.engine.version}`,
        );
        console.log(`Capabilities: ${response.engine.capabilities.join(", ")}`);
        console.log(
          "AI evaluation: disabled. A clean scan would not prove safety.",
        );
      }
    },
  );

registerCheck(program, "check", cancellation.signal);
registerCheck(program, "scan", cancellation.signal);
registerTest(program);

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError)
    process.exitCode =
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version"
        ? 0
        : 2;
  else if (error instanceof EngineError) {
    console.error(`${error.code}: ${error.message}`);
    process.exitCode =
      error.code === "CANCELLED" ? 4 : error.code === "INVALID_OPTIONS" ? 2 : 3;
  } else if (error instanceof ScanError) {
    console.error(`${error.code}: ${error.message}`);
    process.exitCode = error.code === "CANCELLED" ? 4 : 2;
  } else {
    console.error(
      "INTERNAL_ERROR: Operation failed. No skill content is included in this diagnostic.",
    );
    process.exitCode = 4;
  }
}
