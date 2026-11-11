# macOS Timing-Sensitive AI Timeout Test Fix Report

- **Date:** 2026-11-10
- **Baseline Commit:** `8791ba51e2b987a0d213ecee842524fc2e08bcbb` (`master`)
- **Hosted Reference Run:** `https://github.com/naveenkumar80/skillguard/actions/runs/42785169460` (`Check (macos-latest)`, Job `129724458117`)
- **Status:** Fixed in [`python/tests/test_ai.py`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/tests/test_ai.py) and verified locally across repeated test runs, full `pytest`, `pnpm check`, and repository hygiene checks. Awaiting commit/push approval and hosted `macos-latest` CI validation.

---

## 1. Root Cause

Two timeout unit tests in [`python/tests/test_ai.py`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/tests/test_ai.py) failed on hosted `macos-latest` GitHub Actions runners on commit `8791ba51e2b987a0d213ecee842524fc2e08bcbb` (while passing on `ubuntu-latest` and `windows-latest`):

1. **`test_global_timeout_bounds_blocked_provider`**:
   - Configured `timeoutMs=30` against a provider sleeping `0.15s` and asserted `time.monotonic() - start < 0.14`.
   - On `macos-latest`, the call raised `AIError("AI_TIMEOUT")` as expected, but total wall-clock elapsed time measured `~0.148s` (`8ms` over the `0.14s` threshold).
   - That left only `110ms` total headroom above the `30ms` timeout for `validate_request` (`jsonschema`), payload serialization, daemon thread startup/wakeup, and scheduler preemption on shared macOS runners — and only a `10ms` gap below the `0.15s` mock sleep.
2. **`test_timeout_is_global_across_retries`**:
   - Configured `timeoutMs=65` and `maxRetries=2` against retryable failures sleeping `0.04s` per attempt and asserted `time.monotonic() - start < 0.15`.
   - On `macos-latest`, the call raised `AIError("AI_TIMEOUT")` as expected, with elapsed time around `~0.174s` (`24ms` over the `0.15s` threshold), giving only `85ms` total margin for retry overhead and OS timer/thread scheduling jitter.

In both cases, the error-code assertions (`AI_TIMEOUT`) passed; failure was caused strictly by overly tight wall-clock test thresholds coupled to `time.sleep` without deterministic thread synchronization.

---

## 2. Production Code Assessment

No production code changes were needed:

- [`evaluate()`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/skillguard_engine/ai/__init__.py#L215-L313) computes `started = time.monotonic()` and `deadline = started + settings["timeoutMs"] / 1000` once before budget/key checks and before the retry loop.
- [`_call()`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/skillguard_engine/ai/__init__.py#L187-L212) invokes `provider.complete(...)` in a daemon thread and bounds the caller with `result.get(timeout=remaining(deadline))`, raising non-retryable `AIError("AI_TIMEOUT")` on `queue.Empty` without waiting for a stalled provider thread to exit.
- The retry loop catches only `error.retryable`, verifies [`remaining(deadline)`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/skillguard_engine/ai/provider.py#L31-L35) before the next attempt, and passes the identical global `deadline` into every retry without resetting or extending it.
- Existing `OpenAIHTTPSProvider` connection deadline rechecks, `TimeoutError` handling, and `watchdog` timer cancellation in [`provider.py`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/skillguard_engine/ai/provider.py#L38-L120) remain untouched.

---

## 3. Test Design Changes & Before/After Behavior

Only [`python/tests/test_ai.py`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/tests/test_ai.py) was modified (`import threading`, `_FakeClock`, 2 updated tests, and 3 additional regression tests):

| Test                                                               | Before                                                                                      | After                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_global_timeout_bounds_blocked_provider`                      | Slept `0.15s` with `timeoutMs=30`; asserted `elapsed < 0.14` (`110ms` total headroom).      | Blocks on `threading.Event` (`release.wait(timeout=5.0)`) until released in `finally` after `evaluate()` returns with `timeoutMs=100`; deterministically asserts `entered.is_set()`, `not returned.is_set()` prior to `release.set()`, `AI_TIMEOUT`, `call_count == 1`, and bounded `elapsed < 1.5` (catching missing timeouts well below the `5.0s` fallback). |
| `test_timeout_is_global_across_retries`                            | Slept `0.04s` per failure with `timeoutMs=65`; asserted `elapsed < 0.15` (`85ms` headroom). | Waits `0.11s` per retryable failure against `timeoutMs=180` (`maxRetries=2`, `3 * 0.11s = 0.33s` if reset per retry); verifies `AI_TIMEOUT`, `1 <= call_count <= 2`, identical `deadline` values across calls, and bounded `elapsed < 1.5`.                                                                                                                     |
| `test_blocked_retry_interrupted_without_running_remaining_retries` | _(New)_                                                                                     | Fails retryably on attempt 1, blocks attempt 2 on `threading.Event` (`release.wait(timeout=5.0)`) with `timeoutMs=100` (`maxRetries=2`); verifies `AI_TIMEOUT` interrupts attempt 2 before `second_returned.is_set()`, stops before attempt 3 (`call_count == 2`), preserves shared `deadline`, and finishes `< 1.5s`.                                          |
| `test_retries_share_single_global_deadline_without_reset`          | _(New)_                                                                                     | Uses thread-safe `_FakeClock` (`monkeypatch.context()`) with `timeoutMs=5000` (`deadline == 105.0`), advancing `+3.0s` then `+2.5s` across two retryable failures; deterministically verifies `AI_TIMEOUT`, `call_count == 2`, and `deadlines == [105.0, 105.0]` with zero sleep jitter.                                                                        |
| `test_retry_succeeds_within_remaining_global_budget`               | _(New)_                                                                                     | Uses `_FakeClock` with `timeoutMs=5000`; advances `+3.0s` on retryable attempt 1, `+1.0s` on successful attempt 2; verifies findings return cleanly (`attempts == 2`, `deadlines == [105.0, 105.0]`).                                                                                                                                                           |

---

## 4. Verification Results

All checks below executed locally on Windows after editing [`python/tests/test_ai.py`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/python/tests/test_ai.py):

### Repeated Execution of Affected & Regression Timeout Tests

- Command: 20 sequential invocations of `uv run pytest python/tests/test_ai.py -q -k "test_global_timeout_bounds_blocked_provider or test_timeout_is_global_across_retries or test_blocked_retry_interrupted_without_running_remaining_retries or test_retries_share_single_global_deadline_without_reset or test_retry_succeeds_within_remaining_global_budget"`
- Result: **20/20 runs passed** (`100` individual timeout/retry test executions, `0` failures).

### Complete `python/tests/test_ai.py` Suite

- Command: `uv run pytest python/tests/test_ai.py -v`
- Result: **118 passed** in `1.66s` (`0` failed, `0` skipped).

### Full Python Suite (`uv run pytest`)

- Command: `uv run pytest`
- Result: **673 passed** in `7.30s` (`test_ai.py`, `test_foundation.py`, `test_protocol.py`, `test_security.py`).

### Full Monorepo Gate (`pnpm check`) & Hygiene

- `node scripts/check-hygiene.mjs`: Passed (`Repository hygiene check passed.`).
- `npx --yes pnpm@9.15.0 check` (exit code `0`):
  - `pnpm build`: Done
  - `pnpm lint` (`eslint . && uv run ruff check python`): All checks passed
  - `pnpm typecheck` (`tsc --noEmit` & `uv run mypy python`): `Success: no issues found in 13 source files`
  - `vitest run`: **15 test files passed**, **713 passed**, 2 skipped (Windows non-elevated symlink privilege checks in `packages/cli/tests/references.test.ts` and `packages/cli/tests/testing.test.ts`)
  - `uv run pytest`: **673 passed** (`6.60s`)
  - `pnpm format:check` (`prettier --check . && uv run ruff format --check python`): All matched files use Prettier code style (`13` Python files already formatted)
  - **Total Automated Tests:** **1,386 passed** (`713` Vitest + `673` Pytest), `0` failed, `2` host-privilege-skipped.

---

## 5. Remaining Limitations

- **Hosted `macos-latest` Verification Pending:** Local execution ran on Windows 11 (`win32`, Python `3.11.15`). Live execution on GitHub Actions `macos-latest` arm64 runners remains unverified until these changes are reviewed, committed, and pushed in a separate authorized step.
- **Residual Wall-Clock Assumptions:** Three tests retain generous `< 1.5s` bounded wall-clock sanity guards (`test_global_timeout_bounds_blocked_provider`, `test_blocked_retry_interrupted_without_running_remaining_retries`, and `test_timeout_is_global_across_retries`) so missing/unbounded timeouts still fail promptly without creating `1.4s`-wide flakiness; deterministic budget sharing without any wall-clock sensitivity is independently enforced by `_FakeClock`.
