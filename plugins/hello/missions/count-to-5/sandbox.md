# Sandbox — count-to-5

The evaluator reads stdin JSON: `{ missionId, iteration, lastResult?, ... }`.

It emits stdout JSON:
- `{done: false}` when iteration < 5
- `{done: true, reason: "reached 5"}` when iteration >= 5

Allowed tools: none — the evaluator is pure shell arithmetic, no
filesystem writes or subprocess dispatch. See `./evaluator.sh`.
