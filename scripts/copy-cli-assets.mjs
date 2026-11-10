import { copyFile, mkdir, chmod } from "node:fs/promises";
import { URL } from "node:url";

const destination = new URL("../packages/cli/dist/testing/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL("../packages/cli/src/testing/regex-worker.mjs", import.meta.url),
  new URL("regex-worker.mjs", destination),
);
await chmod(new URL("../packages/cli/dist/index.js", import.meta.url), 0o755);
