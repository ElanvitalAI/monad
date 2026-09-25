// ⛔⭐⭐⭐ 왜 이 파일이 있나 — 비-TTY(백그라운드) stdin 에서 EOF 가 오면 readline 은
//    'close' 만 쏘고 'line' 은 «영영» 안 온다. 그런데 호스트가 'line' 만 듣고 있어서
//    질문 promise 가 안 풀리고, 이벤트 루프가 비면서 프로세스가 «exit 0 으로 조용히» 죽었다.
//    ⇒ 30분 타임아웃보다 나쁘다: 그건 느려도 abandoned 로 «관측을 남기는데»,
//      이건 빠르고 «성공처럼 보인다»(.rules R-GIT11 정면 위반 · 실측 2026-08-04 [S]).
import { describe, expect, test } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { createNodeReadlineHost, type ReadlineEvent } from '../src/expression/widget/readline-host';

function sink(): Writable {
  return new Writable({ write(_c, _e, cb) { cb(); } });
}

describe('createNodeReadlineHost — 비-TTY EOF', () => {
  test('⭐ EOF 면 «취소»가 흘러나온다 — 아무 일도 안 일어나면 런이 조용히 죽는다', async () => {
    // 빈 스트림 = 즉시 EOF. 백그라운드로 띄운 자식의 stdin 이 이 모양이다.
    const input = Readable.from([]);
    const host = createNodeReadlineHost({ input, output: sink() });

    // ⛔ 고정 sleep 은 느리고 플래키하다 — «이벤트»로 동기화한다(무인 리뷰 지적).
    const seen: ReadlineEvent[] = [];
    const firstEvent = new Promise<ReadlineEvent>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('EOF 에서 «아무 신호도» 안 나왔다 — 런이 조용히 죽는 형태')), 2_000);
      host.on((ev) => { seen.push(ev); clearTimeout(t); resolve(ev); });
    });

    const ev = await firstEvent;
    // ⛔ 이 단언이 없어서 EOF 가 «아무 신호도 없이» 지나갔다.
    expect(ev.kind).toBe('key');
    expect(ev.kind === 'key' && ev.key.name).toBe('escape');
    // ⭐ 그리고 호스트는 스스로 닫힌다 — 열린 채 남으면 다음 질문이 또 매달린다.
    expect(host.closed).toBe(true);
  });

  test('한 줄 뒤 EOF 면 «line 다음 취소» 순서다 — 순서까지 고정한다', async () => {
    const input = Readable.from(['hello\n']);
    const host = createNodeReadlineHost({ input, output: sink() });
    const seen: ReadlineEvent[] = [];
    const settled = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('EOF 신호가 안 왔다')), 2_000);
      host.on((ev) => {
        seen.push(ev);
        if (ev.kind === 'key') { clearTimeout(t); resolve(); }
      });
    });
    await settled;
    // ⭐ 「line 이 왔다」만 보면 뒤에 붙는 불필요한 취소·중복을 못 잡는다(무인 리뷰 지적).
    expect(seen.map((e) => (e.kind === 'line' ? `line:${e.value}` : `key:${e.key.name}`)))
      .toEqual(['line:hello', 'key:escape']);
  });
});
