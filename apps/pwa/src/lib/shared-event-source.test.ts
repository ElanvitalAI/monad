/** ⛔⭐⭐⭐ 「SSE 사본이 슬롯을 먹는다」를 잡는 자 — 19차 `[F]`.
 *
 *  📏 라이브 실측: 채팅 탭 한 장이 «안 끝나는» 연결 7개를 열었고, HTTP/1.1 한도가 6이라
 *  ***관측 업로드와 위젯 데이터가 영영 큐에 섰다***(§ `shared-event-source.ts` 머리말).
 *  ⇒ 이 자는 그 수를 「접었는지」를 «행위로» 문다 — 소스 문자열이 아니라 실제 연결 수로.
 *
 *  ## ⚠️ 이 자가 답하지 «않는» 것
 *  진짜 브라우저의 연결 한도 — 그건 라이브 축이고, 여기서는 «우리가 몇 개를 여는가»만 잰다. */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  _setEventSourceFactoryForTest,
  openSharedEventSourceCount,
  openSharedEventSourceUrls,
  subscribeSharedEventSource,
} from './shared-event-source';

/** 최소 EventSource 대역 — 만든 수·닫힌 수·리스너를 «센다». */
class FakeEventSource {
  static created: FakeEventSource[] = [];
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string) {
    FakeEventSource.created.push(this);
  }

  addEventListener(name: string, fn: EventListener): void {
    const set = this.listeners.get(name) ?? new Set<EventListener>();
    set.add(fn);
    this.listeners.set(name, set);
  }

  removeEventListener(name: string, fn: EventListener): void {
    this.listeners.get(name)?.delete(fn);
  }

  close(): void { this.closed = true; }

  /** 서버가 이름 있는 프레임을 보냈다고 친다. */
  emit(name: string, data: unknown = {}): void {
    for (const fn of [...(this.listeners.get(name) ?? [])]) {
      fn({ data: JSON.stringify(data) } as unknown as Event);
    }
  }

  /** 이 연결에 «지금» 달린 이름 있는 리스너 총수. */
  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

function install(): void {
  FakeEventSource.created = [];
  _setEventSourceFactoryForTest(((url: string) => new FakeEventSource(url) as unknown as EventSource));
}

afterEach(() => { _setEventSourceFactoryForTest(null); });

describe('공유 SSE — 사본이 몇이든 연결은 «하나»', () => {
  it('⭐ 같은 URL 을 셋이 구독해도 연결은 1개다', () => {
    install();
    const off = [1, 2, 3].map(() => subscribeSharedEventSource('/v1/workflows/events', { events: {} }));
    expect(FakeEventSource.created).toHaveLength(1);
    expect(openSharedEventSourceCount()).toBe(1);
    off.forEach((f) => f());
  });

  it('⛔ «다른» URL 은 접지 않는다 — 합치면 데이터가 섞인다', () => {
    install();
    const a = subscribeSharedEventSource('/v1/events?topics=agent.status', {});
    const b = subscribeSharedEventSource('/v1/events?topics=hud.segment', {});
    expect(openSharedEventSourceCount()).toBe(2);
    expect(openSharedEventSourceUrls()).toEqual([
      '/v1/events?topics=agent.status',
      '/v1/events?topics=hud.segment',
    ]);
    a(); b();
  });

  it('⛔ 마지막 구독자가 떠날 때«만» 닫는다 — 하나 떠났다고 닫으면 남은 쪽이 눈을 잃는다', () => {
    install();
    const off1 = subscribeSharedEventSource('/v1/x/events', {});
    const off2 = subscribeSharedEventSource('/v1/x/events', {});
    const es = FakeEventSource.created[0]!;
    off1();
    expect(es.closed).toBe(false);
    expect(openSharedEventSourceCount()).toBe(1);
    off2();
    expect(es.closed).toBe(true);
    expect(openSharedEventSourceCount()).toBe(0);
  });

  it('⭐ 프레임은 «구독자 전부»에게 가고, 해제한 구독자에겐 «안» 간다', () => {
    install();
    const seenA: string[] = [];
    const seenB: string[] = [];
    const offA = subscribeSharedEventSource('/v1/y/events', { events: { upsert: () => seenA.push('a') } });
    const offB = subscribeSharedEventSource('/v1/y/events', { events: { upsert: () => seenB.push('b') } });
    const es = FakeEventSource.created[0]!;
    es.emit('upsert');
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
    offA();
    es.emit('upsert');
    expect(seenA).toHaveLength(1); // 안 늘었다
    expect(seenB).toHaveLength(2);
    offB();
  });

  it('⛔ 해제를 «두 번» 불러도 참조계수를 두 번 깎지 않는다', () => {
    install();
    const off1 = subscribeSharedEventSource('/v1/z/events', {});
    const off2 = subscribeSharedEventSource('/v1/z/events', {});
    const es = FakeEventSource.created[0]!;
    off1();
    off1(); // 두 번째 호출 — 여기서 남은 구독자를 죽이면 안 된다
    expect(es.closed).toBe(false);
    off2();
    expect(es.closed).toBe(true);
  });

  it('⛔ 리스너는 «연결당 한 벌»이 아니라 «구독자별»로 정확히 떼진다 — 새는지 본다', () => {
    install();
    const off1 = subscribeSharedEventSource('/v1/w/events', { events: { upsert: () => {}, remove: () => {} } });
    const off2 = subscribeSharedEventSource('/v1/w/events', { events: { upsert: () => {} } });
    const es = FakeEventSource.created[0]!;
    expect(es.listenerCount()).toBe(3);
    off1();
    expect(es.listenerCount()).toBe(1); // 1번의 둘만 떨어졌다
    off2();
    expect(es.listenerCount()).toBe(0);
  });

  /** ⛔⭐⭐⭐ 무인 리뷰 must-fix(PR #11378) 를 «무는» 자.
   *
   *  📏 1차판은 참조계수를 `Set<SharedSseHandlers>` 로 셌다 — 즉 «핸들러 객체 identity».
   *  ⇒ ***같은 객체로 두 번 구독하면 Set 에 하나만 들어가고, 첫 해제가
   *    「아직 살아 있는」 두 번째까지 죽인다.*** 🔑 공유 장치가 «남의 눈»을 감긴다.
   *  ⭐ 1차판의 시험이 이걸 못 잡은 이유: 시험이 매번 «새 객체 리터럴»을 넘겼다
   *    — ***자가 자기 편한 입력만 준 것.*** */
  it('⛔ «같은 handlers 객체»로 두 번 구독해도 둘로 센다 — 첫 해제가 둘째를 죽이면 안 된다', () => {
    install();
    const shared = { events: { upsert: () => {} } };
    const off1 = subscribeSharedEventSource('/v1/same/events', shared);
    const off2 = subscribeSharedEventSource('/v1/same/events', shared);
    const es = FakeEventSource.created[0]!;
    off1();
    expect(es.closed).toBe(false);
    expect(openSharedEventSourceCount()).toBe(1);
    off2();
    expect(es.closed).toBe(true);
  });

  it('⭐ 생성 실패를 «말한다» — 호출부가 자기 관측을 남길 수 있게', () => {
    FakeEventSource.created = [];
    _setEventSourceFactoryForTest(() => { throw new Error('no SSE here'); });
    const seen: string[] = [];
    subscribeSharedEventSource('/v1/tell/events', { onConstructError: (e) => seen.push(String(e)) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('no SSE here');
  });

  it('⭐ 생성이 던져도 호출부 계약은 지킨다 — 해제 함수를 돌려준다', () => {
    FakeEventSource.created = [];
    _setEventSourceFactoryForTest(() => { throw new Error('no SSE here'); });
    const off = subscribeSharedEventSource('/v1/boom/events', {});
    expect(typeof off).toBe('function');
    expect(openSharedEventSourceCount()).toBe(0);
    expect(() => off()).not.toThrow();
  });
});

/** ⛔⭐⭐⭐ **「끝나지 않는 연결」의 «예산»** — 19차 `[F]`.
 *
 *  📏 브라우저의 HTTP/1.1 호스트당 동시 연결 한도는 **6**이고, SSE 는 그 슬롯을 «영구 점유»한다.
 *  ⇒ 직접 `new EventSource` 를 여는 자리가 늘면 ***언젠가 조용히 한도를 넘고,
 *    그때 죽는 것은 「SSE」가 아니라 「나머지 전부」다*** — 관측 업로드·위젯 데이터·심지어 문서 요청.
 *
 *  🔑 그래서 이 자는 «금지»하지 않고 ***「수를 세어 내보내고, 늘면 실패»***한다.
 *  ⭐ 줄이는 것은 언제나 통과한다 — 이 숫자는 «내려가기만» 해야 한다.
 *  ⚠️ 이 자가 답하지 «않는» 것: 그 자리들이 «동시에» 열리는지(라우트마다 다르다).
 *    동시 수는 라이브로만 잰다 — CDP Network 로 「안 끝난 요청」을 세면 된다. */
describe('끝나지 않는 연결 «예산»', () => {
  /** 2026-08-22 기준. ⛔ 올리지 마라 — 올려야 할 것 같으면 «공유 구독»으로 접어라. */
  const BUDGET = 5;

  it(`⛔ 공유 모듈 «밖»의 직접 EventSource 는 ${BUDGET}곳 이하다`, async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, resolve: r } = await import('node:path');
    const root = r(import.meta.dir, '..');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        if (p.endsWith('shared-event-source.ts')) continue; // 공유 장치 «자신»은 예산 밖
        const n = (readFileSync(p, 'utf8').match(/new EventSource\(/g) ?? []).length;
        if (n > 0) hits.push(`${p.slice(root.length + 1)} ×${n}`);
      }
    };
    walk(root);
    const total = hits.reduce((s, h) => s + Number(h.split('×')[1]), 0);
    // ⭐ 분모를 «낸다» — 세었으면 내보낸다.
    console.log(`[sse-budget] 공유 모듈 밖 직접 EventSource ${total}곳 (예산 ${BUDGET}):\n  ${hits.join('\n  ')}`);
    expect(`${total}곳`).toBe(`${Math.min(total, BUDGET)}곳`);
  });
});
