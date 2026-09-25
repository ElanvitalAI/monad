// ── 측정 스크립트가 **어느 상수를 귀속하는가** (2026-08-02) ──────────────────────
//
// ⛔ 종전엔 `blockMaxLines` 자리에 `CHAT_DEFAULTS.toolOutput.previewLines` 가 들어 있었다.
//    둘은 다른 층을 정한다(영속 임계 vs 렌더 상한). ⚠️ 그런데 **코드 기본값이 둘 다 8** 이라
//    바꿔 넣어도 **수가 같아** 어떤 테스트도 안 깨졌다.
//    ⇒ ⭐ 값 비교로는 못 잡는다. **서로 다른 값을 주입**해 읽는 필드를 확인한다.

import { describe, expect, test } from 'bun:test';
import { resolveMeasureRenderConfig, chatWinningConstant } from './measure-tool-display-lines.js';
import type { ToolRenderName } from '../src/chat/tool-render/types.js';

/** ⭐ `as never` 를 쓰지 않으려고 최소 입력 모양을 **명시**한다(무인 리뷰 should-fix). */
type MeasureDefaults = { rendering: { tool: { blockMaxLines: number } }; toolOutput?: { previewLines: number } };

describe('measure-tool-display-lines — 어느 상수를 읽는가', () => {
  test('⭐ rendering.tool.blockMaxLines 를 읽는다 (주입으로 확인)', () => {
    const cfg = resolveMeasureRenderConfig({ rendering: { tool: { blockMaxLines: 33 } } });
    expect(cfg.blockMaxLines).toBe(33);
  });

  // ⭐⭐ 되돌림 방지 — previewLines 를 읽는 판이면 이 케이스에서 33 이 아니라 7 이 나온다.
  test('⛔ toolOutput.previewLines 를 읽지 않는다', () => {
    const defaults: MeasureDefaults = {
      rendering: { tool: { blockMaxLines: 33 } },
      toolOutput: { previewLines: 7 },
    };
    const cfg = resolveMeasureRenderConfig(defaults);
    expect(cfg.blockMaxLines).toBe(33);
    expect(cfg.blockMaxLines).not.toBe(7);
  });

  test('winner 라벨이 렌더 상한 이름을 가리킨다', () => {
    expect(chatWinningConstant('Bash' satisfies ToolRenderName, true))
      .toBe('CHAT_DEFAULTS.rendering.tool.blockMaxLines (8)');
  });

  // ⚠️ 기본 예산(8)이 listing 상한(8)과 같으면 `caller` 가 이긴다 — 이것이 현재 계약이다.
  //    listing 이 이기려면 caller 예산이 8 보다 커야 한다.
  test('기본값에서는 listing 이 아니라 caller 가 이긴다 (동률이면 caller)', () => {
    expect(chatWinningConstant('Glob' satisfies ToolRenderName, true))
      .toBe('CHAT_DEFAULTS.rendering.tool.blockMaxLines (8)');
  });

  test('truncate 안 되면 귀속 대상이 없다', () => {
    expect(chatWinningConstant('Bash' satisfies ToolRenderName, false)).toBeNull();
  });
});
