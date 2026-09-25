import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { persistAcpToolTrace } from '../src/acp/tool-trace.js';

/** ⛔⭐⭐⭐ **PWA 턴도 「어떤 도구를 호출했나」를 세션에 남긴다.**
 *
 *  📏 2026-08-22 실측(16차 `[F]`): ***PWA 세션에는 툴 추적이 «하나도» 없었다.***
 *  저장소 role 분포가 `user 205 · assistant 241 · system 12` 였고 **`tool` 이 «0»**.
 *  ⛔ 전수로 원인을 확정했다 — `buildToolTraceMessage()` 를 부르는 곳은 `session/chat.ts`(CLI·TUI) ·
 *  discord · telegram 뿐이고 ***`src/acp/`·`src/nexus/` 에는 없었다.*** 그런데 PWA 는 ACP 경로다.
 *
 *  > 🔑 ***표면마다 감사 추적이 갈렸다*** — CLI·TUI·텔레그램은 남기고 **PWA 만 안 남겼다.**
 *
 *  ---
 *  ## ⛔⭐⭐ 이 파일은 «두 겹»이다 — 1차판이 한 겹뿐이라 Goodhart 였다
 *
 *  📏 무인 리뷰 must-fix(PR #11120): 1차판은 `server.ts` 의 **소스 문자열만** 검사했다.
 *  ⇒ ***배선이 런타임에 죽어도, 엉뚱한 세션·인자를 저장해도 초록***이었다.
 *  ⇒ 그래서 저장 로직을 `src/acp/tool-trace.ts` 로 떼어 **실행으로** 물고(§동작),
 *    그 함수가 «실제로 불리는지»는 소스로 문다(§배선). ⛔ 둘 중 하나만으로는 부족하다:
 *    동작만 물면 아무도 안 부를 수 있고, 소스만 물면 불려도 틀리게 저장할 수 있다. */

const REPO = resolve(import.meta.dir, '..');
const ACP_SERVER = 'src/acp/server.ts';

const codeLinesOf = (rel: string): string[] =>
  readFileSync(resolve(REPO, rel), 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

describe('동작 — persistAcpToolTrace 가 «무엇을» 남기나', () => {
  it('writes a role:tool record carrying the tool name, its args, and its result', () => {
    const seen: Array<{ sessionId: string; msg: Record<string, unknown> }> = [];
    const args = { city: 'Seoul' };
    const result = { content: [], _meta: { ui: { resourceUri: 'ui://x/screen.html' } } };

    const ok = persistAcpToolTrace('sess-A', { id: 'c1', name: 'weather', result }, args, {
      append: (sessionId, msg) => { seen.push({ sessionId, msg: msg as unknown as Record<string, unknown> }); },
    });

    expect(ok).toBe(true);
    expect(seen).toHaveLength(1);
    // ⛔ 세션이 바뀌면 기록이 «남의 대화»에 붙는다 — 그것은 없는 것보다 나쁘다.
    expect(seen[0]!.sessionId).toBe('sess-A');
    expect(seen[0]!.msg.role).toBe('tool');
    expect(seen[0]!.msg.toolName).toBe('weather');
    // ⭐ 인자와 결과가 «둘 다» 실려야 감사 기록이다 — 결과만 남기면 절반짜리다.
    expect(String(seen[0]!.msg.toolArgs)).toContain('Seoul');
    // ⊕ 위젯 복원에 필요한 것은 이 주소다(작아서 절단에 안 걸린다) — 실측으로 확인한 축.
    expect(String(seen[0]!.msg.toolResult)).toContain('ui://x/screen.html');
  });

  it('builds the record through the SHARED builder — a hand-rolled shape must not pass', () => {
    // ⛔⭐📏 무인 리뷰 must-fix(PR #11120): 산출 필드만 검사하면 ***이 모듈이 모양을 손으로
    //   조립해도 통과한다.*** 그러면 계약이 조용히 둘이 되고, 한쪽만 자란 날 기록이 갈린다.
    //   ⇒ 빌더를 «주입해» 그것이 실제로 불리는지, 그리고 그 산출이 그대로 저장되는지 문다.
    const built: Array<[string, unknown, unknown]> = [];
    const sentinel = { role: 'tool', marker: 'from-shared-builder' } as never;
    const stored: unknown[] = [];
    persistAcpToolTrace('sess-E', { id: 'c5', name: 'weather', result: 7 }, { q: 1 }, {
      buildMessage: ((name: string, a: unknown, r: unknown) => { built.push([name, a, r]); return sentinel; }) as never,
      append: (_sid, msg) => { stored.push(msg); },
    });
    // ⓐ 빌더가 «툴 이름 · 인자 · 결과» 셋을 그대로 받았나
    expect(built).toEqual([['weather', { q: 1 }, 7]]);
    // ⓑ 그리고 그 «산출»이 저장됐나 — 중간에 다른 모양으로 갈아치우지 않았나
    expect(stored).toEqual([sentinel]);
  });

  it('is fail-soft — a failing store must not throw into the turn', () => {
    // ⛔ 사람이 보는 화면이 감사 기록보다 앞선다(`session/chat.ts` 가 세운 규율).
    let threw = false;
    let ok = true;
    try {
      ok = persistAcpToolTrace('sess-B', { id: 'c2', name: 't', result: 1 }, {}, {
        append: () => { throw new Error('disk is gone'); },
        observeFailure: () => {},
      });
    } catch { threw = true; }
    expect(threw).toBe(false);
    // ⛔ 「안 했다」와 「했는데 실패했다」는 다른 값이다 — 부르는 쪽이 그것을 알 수 있어야 한다.
    expect(ok).toBe(false);
  });

  it('names the failure instead of swallowing it — the silent failure this session kept catching', () => {
    const failures: Array<Record<string, unknown>> = [];
    persistAcpToolTrace('sess-C', { id: 'c3', name: 'weather', result: 1 }, {}, {
      append: () => { throw new Error('disk is gone'); },
      observeFailure: (info) => { failures.push(info as unknown as Record<string, unknown>); },
    });
    expect(failures).toHaveLength(1);
    // 「어느 세션의 · 어느 툴이 · 왜」 — 셋이 없으면 나중에 원인을 못 가른다.
    expect(failures[0]).toMatchObject({ sessionId: 'sess-C', tool: 'weather', id: 'c3' });
    expect(String(failures[0]!.reason)).toContain('disk is gone');
  });

  it('survives an observer that itself throws — observation is the last line, not a new failure mode', () => {
    let threw = false;
    try {
      persistAcpToolTrace('sess-D', { id: 'c4', name: 't', result: 1 }, {}, {
        append: () => { throw new Error('store down'); },
        observeFailure: () => { throw new Error('logger down'); },
      });
    } catch { threw = true; }
    expect(threw).toBe(false);
  });
});

describe('배선 — ACP 서버가 그 함수를 «실제로» 부르나', () => {
  it('calls persistAcpToolTrace on the tool-result path exactly once', () => {
    // ⛔⭐ 위 동작 시험은 「함수가 옳다」만 본다 — ***아무도 안 불러도 초록이다.***
    //   📏 그리고 이 PR 이 실제로 그 함정을 밟았다: 처음엔 «안 도는 발신자»에 배선했고
    //     시험 다섯이 전부 초록이었는데 라이브에서 `tool` 이 0으로 남았다.
    const calls = codeLinesOf(ACP_SERVER).filter((line) => line.includes('persistAcpToolTrace('));
    expect(calls).toHaveLength(1);
  });

  it('pairs the args by call id and releases them afterwards', () => {
    const code = codeLinesOf(ACP_SERVER);
    expect(code.some((line) => /toolCallArgs\s*\.\s*set\(\s*call\.id/.test(line))).toBe(true);
    expect(code.some((line) => /toolCallArgs\s*\.\s*get\(\s*call\.id/.test(line))).toBe(true);
    // ⛔ 긴 턴에서 끝난 호출의 인자를 붙잡아 두지 않는다(리뷰 should-fix).
    expect(code.some((line) => /toolCallArgs\s*\.\s*delete\(\s*call\.id/.test(line))).toBe(true);
  });

  it('the trace module sources its shape from the shared builder, not a local copy', () => {
    // ⛔ 주입 시험(위)은 「주입하면 그것을 쓴다」를 보고, 이 검사는 «기본값»이 공유 빌더인지를 본다.
    //   둘이 짝이다 — 기본이 지역 복제로 바뀌면 주입 시험은 여전히 초록이기 때문이다.
    const code = codeLinesOf('src/acp/tool-trace.ts');
    expect(code.some((l) => l.includes('buildToolTraceMessage') && l.includes('import'))).toBe(true);
    expect(code.some((l) => /deps\.buildMessage\s*\?\?\s*buildToolTraceMessage/.test(l))).toBe(true);
  });

  it('does not hand-roll the trace message shape in the server', () => {
    // 모양은 `session/chat.ts` 가 갖고 `tool-trace.ts` 만 그것을 쓴다 — 계약을 두 벌로 두지 않는다.
    expect(codeLinesOf(ACP_SERVER).some((line) => line.includes('buildToolTraceMessage'))).toBe(false);
  });
});
