# Tier 1 e2e smoke (M7 · 2026-04-28)

Tier 1 시나리오 (S1-S7) 의 자동화 진입점. 7 file 모두 환경 변수
`ELANOUS_CODEX_TIER1_SMOKE=1` 일 때만 실행 — 평소 `bun test` 회귀에
영향 없음.

## 수동 실행

```bash
# 풀 Tier 1 suite
ELANOUS_CODEX_TIER1_SMOKE=1 bun test test/integration/acp-tier1-*.test.ts

# 단일 시나리오
ELANOUS_CODEX_TIER1_SMOKE=1 bun test test/integration/acp-tier1-s4-codex-app-server.test.ts
```

## 시나리오 매트릭스

`내부 문서` §2 의 S1-S7 답습.

| # | scenario | 상태 (sprint 3) | comment |
|---|---|---|---|
| **S1** | claude-code-acp basic round-trip | stub | claude-code-acp + ANTHROPIC_API_KEY 필요 |
| **S2** | codex-acp 3-turn 문맥 보존 | stub | OPENAI_API_KEY 필요 |
| **S3** | codex-native single turn | stub | M10 (sprint 5) 시 archive 대상 |
| **S4** | **codex-app-server real binary** | ✅ active | initialize handshake + capability echo |
| **S5** | multi-backend session 격리 | stub | 2 backend concurrent + session bleed check |
| **S6** | LLM-driven background turn | stub | task #8 (holistic) 후 작성 |
| **S7** | elanous-as-server (MT5b) echo | stub | acp/server.ts 회귀 검증 |

S4 는 본 sprint 3 의 **active scenario** — 실 codex binary 로
sprint 1+2+3 capability flip (planMode / fileOps / loadSession / ui)
이 protocol 위에 visible 한지 검증.

## 환경 prereq

- `codex` binary on PATH (`which codex` returns absolute path)
- (S1) `claude-code-acp` on PATH + `ANTHROPIC_API_KEY` env
- (S2/S3/S4) `OPENAI_API_KEY` env (실 turn 검증 시 · S4 의 현재 smoke 는
  initialize 까지만 → token 미소비)

`tier1SkipReason()` 이 환경 prereq 미충족 시 명확한 메시지 + 모든 test
skip — 실패가 아닌 skip 으로 분류되어 회귀 noise 0.

## CI 등록

본 repo 는 현재 GitHub Actions workflow 미사용. Tier 1 smoke 는 사용자
manual `ELANOUS_CODEX_TIER1_SMOKE=1 bun test test/integration/...` 로
실행한다. CI 도입 시 본 suite 가 첫 후보 — `tier1SkipReason()` 이
secret/binary 부재 시 clean skip 처리하므로 nightly cron 등록만 남음.

## 추가 시나리오

본 폴더 안에 `acp-tier1-*.test.ts` 파일을 추가하면 자동으로 suite 에
포함. 모든 새 file 은 다음 패턴 따름:

```ts
import { describe, test } from 'bun:test';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('SX', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · SX · ...', () => {
  test('...', async () => { /* real binary spawn + assertions */ });
});
```
