import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineRequest } from "../src/core/models.js";

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));
import {
  engineEnvironment,
  invokeEngine,
  MAX_DIAGNOSTIC_BYTES,
  MAX_OUTPUT_BYTES,
} from "../src/engine/client.js";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit("close", null, "SIGKILL"));
    return true;
  });
}
const request: EngineRequest = {
  protocolVersion: "1.0",
  command: "doctor",
  files: [],
};
const response = {
  protocolVersion: "1.0",
  ok: true,
  findings: [],
  engine: { version: "0.1.0", capabilities: ["doctor"], ruleSetVersion: null },
};
let child: FakeChild;
function reply(value: unknown = response, code = 0): void {
  child.stdout.write(JSON.stringify(value));
  child.emit("close", code, null);
}
beforeEach(() => {
  child = new FakeChild();
  mocked.spawn.mockReset().mockReturnValue(child);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("subprocess trust boundary", () => {
  it("uses isolated Python, neutral cwd, no shell, and an environment allowlist", async () => {
    const result = invokeEngine(request, { executable: "trusted-python" });
    reply();
    await expect(result).resolves.toEqual(response);
    const [executable, args, options] = mocked.spawn.mock.calls[0] ?? [];
    expect(executable).toBe("trusted-python");
    expect(args).toEqual(["-I", "-m", "skillguard_engine"]);
    expect(options).toMatchObject({ shell: false, windowsHide: true });
    expect(options.cwd).toBeTruthy();
    expect(child.stdin.read().toString()).toBe(JSON.stringify(request));
  });
  it("does not forward credentials, user Python hooks or package-manager environment", () => {
    expect(
      engineEnvironment({
        Path: "bin",
        SYSTEMROOT: "C:\\Windows",
        TEMP: "tmp",
        OPENAI_API_KEY: "private",
        PYTHONPATH: "untrusted",
        HOME: "private",
        NODE_OPTIONS: "hook",
        npm_config_token: "private",
      }),
    ).toEqual({ Path: "bin", SYSTEMROOT: "C:\\Windows", TEMP: "tmp" });
  });
  it("does not spawn on invalid requests", async () => {
    await expect(
      invokeEngine({ ...request, files: [{ path: "../x", content: "" }] }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(mocked.spawn).not.toHaveBeenCalled();
  });
  it.each([0, -1, 120001, NaN, 1.5])(
    "rejects invalid timeout %s",
    async (timeoutMs) => {
      await expect(invokeEngine(request, { timeoutMs })).rejects.toMatchObject({
        code: "INVALID_OPTIONS",
      });
      expect(mocked.spawn).not.toHaveBeenCalled();
    },
  );
  it("enforces request byte limit including multibyte content", async () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      path: `${index}.md`,
      content: "漢".repeat(262144),
    }));
    await expect(
      invokeEngine({ ...request, command: "scan", files }),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(mocked.spawn).not.toHaveBeenCalled();
  });
  it("terminates timeout and waits for process close", async () => {
    vi.useFakeTimers();
    const result = invokeEngine(request, { timeoutMs: 20 });
    const assertion = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("cancels an active process", async () => {
    const controller = new AbortController();
    const result = invokeEngine(request, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    expect(child.kill).toHaveBeenCalled();
  });
  it("does not launch on pre-cancellation", async () => {
    await expect(
      invokeEngine(request, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(mocked.spawn).not.toHaveBeenCalled();
  });
  it.each(["stdout", "stderr"] as const)(
    "terminates excessive %s without echoing content",
    async (stream) => {
      const result = invokeEngine(request);
      child[stream].write(
        "x".repeat(
          (stream === "stdout" ? MAX_OUTPUT_BYTES : MAX_DIAGNOSTIC_BYTES) + 1,
        ),
      );
      await expect(result).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
      expect(child.kill).toHaveBeenCalled();
    },
  );
  it("handles unavailable interpreters without echoing OS errors", async () => {
    const result = invokeEngine(request);
    child.emit("error", new Error("PRIVATE_PATH"));
    child.emit("close", -2, null);
    await expect(result).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE" });
    await expect(result).rejects.not.toThrow("PRIVATE_PATH");
  });
  it.each(["not JSON PRIVATE_CONTENT", "{} {}", "{", ""])(
    "rejects malformed engine JSON %#",
    async (content) => {
      const result = invokeEngine(request);
      child.stdout.write(content);
      child.stderr.write("PRIVATE_CONTENT");
      child.emit("close", 0, null);
      await expect(result).rejects.toMatchObject({ code: "INVALID_JSON" });
      await expect(result).rejects.not.toThrow("PRIVATE_CONTENT");
    },
  );
  it("rejects invalid UTF8", async () => {
    const result = invokeEngine(request);
    child.stdout.write(Buffer.from([0xff]));
    child.emit("close", 0, null);
    await expect(result).rejects.toMatchObject({ code: "INVALID_JSON" });
  });
  it("rejects incompatible protocol", async () => {
    const result = invokeEngine(request);
    reply({ ...response, protocolVersion: "2.0" });
    await expect(result).rejects.toMatchObject({
      code: "UNSUPPORTED_PROTOCOL",
    });
  });
  it("rejects malformed findings", async () => {
    const result = invokeEngine(request);
    reply({ ...response, findings: [{}] });
    await expect(result).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects undeclared capabilities", async () => {
    const result = invokeEngine(request);
    reply({ ...response, engine: { ...response.engine, capabilities: [] } });
    await expect(result).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("does not expose structured engine error messages", async () => {
    const result = invokeEngine(request);
    reply(
      {
        protocolVersion: "1.0",
        ok: false,
        findings: [],
        error: {
          code: "NOT_IMPLEMENTED",
          message: "PRIVATE_CONTENT",
          retryable: false,
        },
      },
      3,
    );
    await expect(result).rejects.toThrow("NOT_IMPLEMENTED");
    await expect(result).rejects.not.toThrow("PRIVATE_CONTENT");
  });
  it("handles crash with a misleading success response", async () => {
    const result = invokeEngine(request);
    reply(response, 7);
    await expect(result).rejects.toMatchObject({ code: "ENGINE_CRASH" });
  });
  it("handles abrupt signal death", async () => {
    const result = invokeEngine(request);
    child.emit("close", null, "SIGTERM");
    await expect(result).rejects.toMatchObject({ code: "ENGINE_CRASH" });
  });
});
