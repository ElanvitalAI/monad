// 광역검색 가드의 «차단»이 관측에 남는지 — 2026-08-18.
//
// ⛔ 왜 이 테스트가 있나: 종전엔 차단이 `throw` 만 하고 아무 로그도 안 남겼다.
//   그래서 `PLAN-grok-native-structure-absorption` §5 ①("RUNTIME BLOCKED 건수")이
//   ***원리상 잴 수 없었다*** — 조회하면 0 이 나오는데 그 0 은 「안 막혔다」가 아니라 「안 쟀다」였다.
//
// ⛔⭐ 임계(몇 회 연속에서 막히나)를 «단언하지 않는다» — CLAUDE.md 가 못 박았듯
//   그 수는 패턴·스코프 조합에 따라 갈린다(같은 가드가 4회에서도 5회에서도 막힌 실측이 있다).
//   ⇒ 「막힐 때까지 돌리고, 막혔으면 관측이 있는가」만 본다.

import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchGrep } from './grep.js';
import { setSessionCwd, getSessionCwd } from '../../session/working-dir.js';
import { debug } from '../../debug/log.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'broad-search-obs-')));
writeFileSync(join(root, 'a.txt'), 'alpha beta gamma\n');
writeFileSync(join(root, 'b.txt'), 'alpha delta\n');

const prev = getSessionCwd();
setSessionCwd(root, 'tool');
afterAll(() => {
  try { setSessionCwd(prev, 'tool'); } catch { /* noop */ }
  rmSync(root, { recursive: true, force: true });
});

const hasRg = (() => { try { return spawnSync('rg', ['--version']).status === 0; } catch { return false; } })();
const maybe = hasRg ? test : test.skip;

describe('광역검색 차단은 «관측»에 남는다', () => {
  maybe('막힐 때까지 돌리면 tools.search/broad-search-blocked 가 «한 번은» 찍힌다', async () => {
    const seen: Array<{ category: string; event: string; data?: unknown }> = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown) => {
      seen.push({ category, event, data });
    }) as typeof debug.log;

    let blocked = false;
    try {
      // ⛔ 임계를 모르므로 넉넉히 돌리되, 막히면 «즉시» 멈춘다.
      for (let i = 0; i < 12 && !blocked; i++) {
        try {
          await dispatchGrep({ pattern: 'alpha', output_mode: 'files_with_matches' } as never);
        } catch (err) {
          if (String(err).includes('RUNTIME BLOCKED')) blocked = true;
          else throw err;
        }
      }
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }

    // 반증: 막히지 않았다면 이 테스트는 «아무것도 증명하지 못한다» — 그 사실을 드러낸다.
    expect(blocked).toBe(true);

    const blocks = seen.filter(e => e.category === 'tools.search' && e.event === 'broad-search-blocked');
    // ⛔ 「0보다 많다」로는 «차단 «전»에도 찍는» 회귀를 못 잡는다(리뷰 should-fix).
    //   루프는 막히면 «즉시» 멈추므로 차단은 «정확히 한 번» 일어났다 ⇒ 이벤트도 한 번이어야 한다.
    expect(blocks.length).toBe(1);

    // 관측이 «값»을 싣는다 — 수 · on/off 축 · 힌트 노출 여부.
    //   셋 중 하나라도 없으면 나중에 §5 의 on/off 대조를 못 한다.
    const payload = blocks[0]?.data as Record<string, unknown> | undefined;
    expect(typeof payload?.consecutive).toBe('number');
    expect(typeof payload?.nativeStructureEnabled).toBe('boolean');
    expect(typeof payload?.delegationHintShown).toBe('boolean');
  });
});
