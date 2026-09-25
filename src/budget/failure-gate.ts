// H6 P1 Bundle 1 · ConsecutiveFailureGate.
//
// Ported from CodexBar `UsageStoreSupport.swift` (`ConsecutiveFailureGate`).
// A single fetcher flake when we already have fresh data is almost
// always transient (network blip · OAuth 429 · PTY race) · surfacing
// it to the UI on the first failure causes red-flag fatigue. Swallow
// the first; surface anything from the second onward.
//
// Each fetcher owns one gate; gates are independent across providers
// so a Codex flake doesn't silence a Claude one.

export class ConsecutiveFailureGate {
  private _streak = 0;

  /** Current failure streak (0 = last outcome was success or never
   *  queried). Exposed mainly for tests and debug output. */
  get streak(): number {
    return this._streak;
  }

  /** Reset streak after a successful fetch. */
  recordSuccess(): void {
    this._streak = 0;
  }

  /** Reset streak without attributing a success (e.g. provider toggled
   *  off by user · we want a clean slate on re-enable). */
  reset(): void {
    this._streak = 0;
  }

  /** Record a failure and decide whether the UI should see it.
   *
   *  Returns `true` when the error should surface (streak >= 2 OR we
   *  had no prior data to fall back on). Returns `false` when the
   *  caller should silently keep showing the previous snapshot.
   *
   *  The rule mirrors CodexBar exactly: first failure *with* prior
   *  data = swallow; first failure *without* prior data = surface
   *  (user needs to know why there's no data at all). */
  shouldSurfaceError(onFailureWithPriorData: boolean): boolean {
    this._streak += 1;
    if (onFailureWithPriorData && this._streak === 1) return false;
    return true;
  }
}
