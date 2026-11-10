import type { Config } from "../config/config.js";
import { assertionFailure } from "./assertions.js";
import type { TestResult, TestRun } from "./models.js";
import { loadSuite } from "./suite.js";

export type { TestResult, TestRun } from "./models.js";

/** Evaluate recorded fixtures only; prompts and skill contents are never executed. */
export async function runTests(root: string, config: Config): Promise<TestRun> {
  const tests = await loadSuite(root, config);
  const results: TestResult[] = [];
  for (const test of tests) {
    const failures: string[] = [];
    for (const assertion of test.assertions) {
      const failure = await assertionFailure(test.output, assertion);
      if (failure !== undefined) failures.push(failure);
    }
    results.push({
      id: test.id,
      ...(test.group !== undefined ? { group: test.group } : {}),
      passed: failures.length === 0,
      failures,
      skill: test.skill,
    });
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    schemaVersion: "1.0",
    passed,
    failed: results.length - passed,
    results,
  };
}
