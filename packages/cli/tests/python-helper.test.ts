import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { resolveTestPython } from "./helpers/python.js";

describe("resolveTestPython cross-platform helper", () => {
  it("selects .venv/Scripts/python.exe on Windows", () => {
    const expected = "C:\\repo\\.venv\\Scripts\\python.exe";
    const resolved = resolveTestPython({
      env: {},
      platform: "win32",
      repoRoot: "C:\\repo",
      isFile: (candidate) => candidate === expected,
    });
    expect(resolved).toBe(expected);
  });

  it("selects .venv/bin/python on Linux and macOS", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const expected = "/home/runner/work/skillguard/.venv/bin/python";
      const resolved = resolveTestPython({
        env: {},
        platform,
        repoRoot: "/home/runner/work/skillguard",
        isFile: (candidate) => candidate === expected,
      });
      expect(resolved).toBe(expected);
    }
  });

  it("respects explicit SKILLGUARD_PYTHON path overrides (absolute and relative)", () => {
    const customAbs = "/opt/python/3.11/bin/python3";
    expect(
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: customAbs },
        platform: "linux",
        repoRoot: "/repo",
        isFile: (candidate) => candidate === customAbs,
      }),
    ).toBe(customAbs);

    const expectedRel = "C:\\repo\\tools\\python\\python.exe";
    expect(
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: "tools\\python\\python.exe" },
        platform: "win32",
        repoRoot: "C:\\repo",
        isFile: (candidate) => candidate === expectedRel,
      }),
    ).toBe(expectedRel);
  });

  it("respects bare command names in SKILLGUARD_PYTHON when present on PATH", () => {
    const posixExpected = "/usr/local/bin/python3.11";
    expect(
      resolveTestPython({
        env: {
          SKILLGUARD_PYTHON: "python3.11",
          PATH: "/bin:/usr/local/bin",
        },
        platform: "linux",
        repoRoot: "/repo",
        isFile: (candidate) => candidate === posixExpected,
      }),
    ).toBe(posixExpected);

    const winExpected = "C:\\Python311\\python.exe";
    expect(
      resolveTestPython({
        env: {
          SKILLGUARD_PYTHON: "python",
          PATH: "C:\\Other;C:\\Python311",
          PATHEXT: ".EXE;.BAT",
        },
        platform: "win32",
        repoRoot: "C:\\repo",
        isFile: (candidate) => candidate === winExpected,
      }),
    ).toBe(winExpected);
  });

  it("fails with a clear diagnostic when the executable does not exist", () => {
    expect(() =>
      resolveTestPython({
        env: {},
        platform: "linux",
        repoRoot: "/repo",
        isFile: () => false,
      }),
    ).toThrow(
      /Project virtual environment Python interpreter not found.*uv sync/u,
    );

    expect(() =>
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: "/missing/bin/python" },
        platform: "linux",
        repoRoot: "/repo",
        isFile: () => false,
      }),
    ).toThrow(/Configured SKILLGUARD_PYTHON interpreter was not found/u);

    expect(() =>
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: "missing-python-cmd", PATH: "/usr/bin" },
        platform: "linux",
        repoRoot: "/repo",
        isFile: () => false,
      }),
    ).toThrow(
      /Configured SKILLGUARD_PYTHON command "missing-python-cmd" was not found on PATH/u,
    );

    expect(() =>
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: "   " },
        platform: "linux",
        repoRoot: "/repo",
        isFile: () => true,
      }),
    ).toThrow(/Invalid SKILLGUARD_PYTHON environment variable/u);

    expect(() =>
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: "/bad\0/python" },
        platform: "linux",
        repoRoot: "/repo",
        isFile: () => true,
      }),
    ).toThrow(/Invalid SKILLGUARD_PYTHON environment variable/u);
  });

  it("preserves paths containing spaces for both repoRoot and SKILLGUARD_PYTHON", () => {
    const spacedPosix = "/tmp/my spaced repo/.venv/bin/python";
    expect(
      resolveTestPython({
        env: {},
        platform: "linux",
        repoRoot: "/tmp/my spaced repo",
        isFile: (candidate) => candidate === spacedPosix,
      }),
    ).toBe(spacedPosix);

    const spacedWinOverride =
      "C:\\Program Files\\SkillGuard Python\\python.exe";
    expect(
      resolveTestPython({
        env: { SKILLGUARD_PYTHON: spacedWinOverride },
        platform: "win32",
        repoRoot: "C:\\My Workspace\\skillguard",
        isFile: (candidate) => candidate === spacedWinOverride,
      }),
    ).toBe(spacedWinOverride);

    // Real filesystem check with an actual temporary directory containing spaces
    const baseDir = mkdtempSync(join(tmpdir(), "sg space test "));
    try {
      const targetExe =
        process.platform === "win32"
          ? join(baseDir, ".venv", "Scripts", "python.exe")
          : join(baseDir, ".venv", "bin", "python");
      mkdirSync(join(targetExe, ".."), { recursive: true });
      writeFileSync(targetExe, "stub");
      const resolved = resolveTestPython({ env: {}, repoRoot: baseDir });
      expect(resolved).toBe(targetExe);
      expect(existsSync(resolved)).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("resolves the real project .venv Python interpreter reliably on the current host", () => {
    const envCopy = { ...process.env };
    delete envCopy["SKILLGUARD_PYTHON"];
    const resolved = resolveTestPython({ env: envCopy });
    expect(existsSync(resolved)).toBe(true);
    if (process.platform === "win32") {
      expect(resolved.replaceAll("\\", "/")).toMatch(
        /\/\.venv\/Scripts\/python\.exe$/u,
      );
    } else {
      expect(resolved).toMatch(/\/\.venv\/bin\/python$/u);
    }
  });
});
