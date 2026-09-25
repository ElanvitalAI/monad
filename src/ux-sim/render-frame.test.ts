// 시뮬레이터 프레임 계약 — 실제 위젯 render 가 심은 state 를 돌려준다.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { stripAnsi } from '../tui.js';
import { simRenderLogFrame, type SimFrame } from './render-frame.js';

const RENDER_FRAME_SOURCE = readFileSync(new URL('./render-frame.ts', import.meta.url), 'utf8');

type HasSplice<T> = T extends { splice: (...args: never[]) => unknown } ? true : false;
type LastVisible = SimFrame['state']['lastVisibleLineIndices'];
const lastVisibleRejectsSplice: HasSplice<LastVisible> extends true ? never : true = true;
void lastVisibleRejectsSplice;

describe('simRenderLogFrame — 기존 lines/text 계약', () => {
  test('기존 호출 형태는 lines 와 text 를 그대로 낸다', () => {
    const frame = simRenderLogFrame({ phase: 'streaming' }, { width: 60, height: 8 });
    expect(Array.isArray(frame.lines)).toBe(true);
    expect(typeof frame.text).toBe('string');
    expect(frame.text).toBe(frame.lines.join('\n'));
    expect(frame.lines.length).toBeLessThanOrEqual(8);
    expect(frame.text).toContain('Streaming');
  });
});

describe('simRenderLogFrame — 실제 위젯 render 경로', () => {
  test('부르는 렌더는 widgets/log/widget.ts 이고 흉내 렌더러가 아니다', () => {
    expect(RENDER_FRAME_SOURCE).toContain("from '../../widgets/log/widget.js'");
    expect(RENDER_FRAME_SOURCE).toMatch(/logWidget\.render/);
    expect(RENDER_FRAME_SOURCE).not.toMatch(/function\s+fakeRender/);
    expect(RENDER_FRAME_SOURCE).not.toMatch(/mockRender/);
  });
});

describe('simRenderLogFrame — 렌더 뒤 state', () => {
  test('호출자가 lastVisibleLineIndices·origin 을 읽을 수 있다', () => {
    const frame = simRenderLogFrame(
      { phase: 'idle', lines: ['alpha', 'beta', 'gamma'] },
      { width: 80, height: 10, originRow: 4, originCol: 2 },
    );
    const indices = frame.state.lastVisibleLineIndices;
    expect(Array.isArray(indices)).toBe(true);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.every((n) => typeof n === 'number')).toBe(true);
    expect(indices).toHaveLength(frame.lines.length - 1);
    expect(frame.state.lastRenderOriginRow).toBe(4);
    expect(frame.state.lastRenderOriginCol).toBe(2);
  });

  test('스냅샷은 클릭 매핑 세 필드만 노출한다', () => {
    const frame = simRenderLogFrame(
      { phase: 'idle', lines: ['alpha', 'beta'] },
      { width: 80, height: 8, originRow: 1, originCol: 1 },
    );
    expect(Object.keys(frame.state).sort()).toEqual([
      'lastRenderOriginCol',
      'lastRenderOriginRow',
      'lastVisibleLineIndices',
    ]);
    expect('lines' in frame.state).toBe(false);
    expect('clickDeps' in frame.state).toBe(false);
    expect('footerLine' in frame.state).toBe(false);
  });

  test('돌려준 state 를 바꿔도 다음 렌더의 lines 는 같다', () => {
    const spec = { phase: 'streaming' as const, lines: ['keep-a', 'keep-b', 'keep-c'] };
    const first = simRenderLogFrame(spec, { width: 80, height: 12 });
    const firstLines = [...first.lines];
    try {
      (first.state.lastVisibleLineIndices as number[]).splice(0);
    } catch {
      // frozen snapshot — mutation is rejected
    }
    const second = simRenderLogFrame(spec, { width: 80, height: 12 });
    expect(second.lines).toEqual(firstLines);
  });

  test('반환 스냅샷 배열은 입력 extraState 와 참조가 갈린다', () => {
    const extraIndices = [0, 1, 2];
    const extraState = { lastVisibleLineIndices: extraIndices };
    const frame = simRenderLogFrame(
      { phase: 'idle', lines: ['a', 'b', 'c'] },
      { width: 80, height: 10, extraState },
    );
    expect(frame.state.lastVisibleLineIndices).not.toBe(extraIndices);
    extraIndices.splice(0);
    expect(frame.state.lastVisibleLineIndices.length).toBeGreaterThan(0);

    const snapshotLen = frame.state.lastVisibleLineIndices.length;
    expect(() => (frame.state.lastVisibleLineIndices as number[]).splice(0)).toThrow();
    expect(frame.state.lastVisibleLineIndices).toHaveLength(snapshotLen);
    expect(extraIndices).toEqual([]);
  });

  test('tail 기본 상태에서 보이는 줄과 매핑되는 소스 줄이 일치한다', () => {
    const sourceLines = Array.from({ length: 40 }, (_, i) => `source-line-${String(i).padStart(2, '0')}`);
    const frame = simRenderLogFrame(
      { phase: 'idle', lines: sourceLines },
      { width: 80, height: 20 },
    );
    const body = frame.lines.slice(1);
    const indices = frame.state.lastVisibleLineIndices;
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toHaveLength(body.length);

    for (let i = 0; i < body.length; i++) {
      const sourceIdx = indices[i]!;
      const visible = stripAnsi(body[i]!);
      if (sourceIdx < 0) {
        expect(visible.trim()).toBe('');
        continue;
      }
      expect(visible).toContain(sourceLines[sourceIdx]!);
    }
  });
});
