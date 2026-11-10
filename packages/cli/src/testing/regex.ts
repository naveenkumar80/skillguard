import { Worker } from "node:worker_threads";

export type RegexResult =
  | "matched"
  | "not_matched"
  | "invalid"
  | "timed_out"
  | "unavailable";

export async function boundedRegex(
  pattern: string,
  flags: string,
  input: string,
): Promise<RegexResult> {
  if (pattern.length > 256 || input.length > 262_144) return "invalid";
  let worker: Worker;
  try {
    worker = new Worker(new URL("./regex-worker.mjs", import.meta.url), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 4 },
    });
  } catch {
    return "unavailable";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<RegexResult>((resolve) => {
      let ready = false;
      let settled = false;
      const finish = (result: RegexResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      // Startup has its own finite bound; the 100 ms match budget starts only
      // after the static worker is ready, not during OS scheduling/module loading.
      timer = setTimeout(() => finish("unavailable"), 5000);
      worker.on("error", () => finish("unavailable"));
      worker.on("exit", () => finish("unavailable"));
      worker.on("message", (message: unknown) => {
        if (settled) return;
        if (!ready && message === "ready") {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish("timed_out"), 100);
          worker.postMessage({ pattern, flags, input });
        } else if (
          ready &&
          (message === "matched" ||
            message === "not_matched" ||
            message === "invalid")
        ) {
          finish(message);
        } else {
          finish("unavailable");
        }
      });
    });
  } finally {
    clearTimeout(timer);
    // Never leave a catastrophic match running after returning its failure.
    await worker.terminate();
  }
}
