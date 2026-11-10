import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { invokeEngine } from "../src/engine/client.js";

const executable = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../../../.venv/Scripts/python.exe"
      : "../../../.venv/bin/python",
    import.meta.url,
  ),
);
describe("installed Python subprocess integration", () => {
  it("exchanges a real doctor request from a neutral cwd", async () => {
    const response = await invokeEngine(
      { protocolVersion: "1.0", command: "doctor", files: [] },
      { executable },
    );
    expect(response.engine.version).toBe("0.1.0");
    expect(response.engine.capabilities).toEqual([
      "doctor",
      "scan",
      "evaluate",
    ]);
    expect(response.findings).toEqual([]);
  });
  it("returns static security findings without leaking matched content", async () => {
    const credential = "ghp_" + "A".repeat(36);
    const response = await invokeEngine(
      {
        protocolVersion: "1.0",
        command: "scan",
        files: [{ path: "demo/SKILL.md", content: credential }],
      },
      { executable },
    );
    expect(
      response.findings.some((finding) => finding.ruleId === "SG-SEC-001"),
    ).toBe(true);
    expect(JSON.stringify(response)).not.toContain(credential);
    expect(response.engine.ruleSetVersion).toBe("1.0.0");
  });
  it("handles a missing runtime", async () => {
    await expect(
      invokeEngine(
        { protocolVersion: "1.0", command: "doctor", files: [] },
        { executable: "skillguard-nonexistent-python-runtime" },
      ),
    ).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE" });
  });
  it("terminates an actual Python child on a short deadline", async () => {
    await expect(
      invokeEngine(
        { protocolVersion: "1.0", command: "doctor", files: [] },
        { executable, timeoutMs: 1 },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
