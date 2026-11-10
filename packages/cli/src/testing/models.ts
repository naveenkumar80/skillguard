export interface TestResult {
  id: string;
  group?: string;
  passed: boolean;
  failures: string[];
  skill: string;
}

export interface TestRun {
  schemaVersion: "1.0";
  passed: number;
  failed: number;
  results: TestResult[];
}
