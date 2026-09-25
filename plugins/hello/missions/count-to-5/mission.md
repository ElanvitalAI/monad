# Mission — Count To Five

Goal: drive an iteration counter from 0 to 5, with `done=true` when the
counter reaches 5. Minimum smoke test for the PX-4 mission pipeline.

## Constraints

- keepPolicy: `pass_only` — only the final iteration counts as progress
  (the evaluator reports `done=false` until the 5th invocation).
- maxIterations: 6 — one spare before the runtime force-aborts.
- cadence: every turn (no throttle).
- timeoutMs: 5_000 — evaluator is cheap.

## Non-goals

- Not a real goal; purely a dogfood for the evaluator → registry →
  Turn-hook pipeline. The docs reference it for the first-time reader.
