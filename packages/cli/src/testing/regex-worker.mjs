import { parentPort } from "node:worker_threads";

// This is the only executable worker source. Suites supply data, never code.
parentPort.once("message", ({ pattern, flags, input }) => {
  if (
    typeof pattern !== "string" ||
    pattern.length > 256 ||
    typeof input !== "string" ||
    input.length > 262_144 ||
    typeof flags !== "string" ||
    !/^[imsu]{0,4}$/u.test(flags) ||
    new Set(flags).size !== flags.length
  ) {
    parentPort.postMessage("invalid");
    return;
  }
  try {
    const matches = new RegExp(pattern, flags).test(input);
    parentPort.postMessage(matches ? "matched" : "not_matched");
  } catch {
    parentPort.postMessage("invalid");
  }
});
parentPort.postMessage("ready");
