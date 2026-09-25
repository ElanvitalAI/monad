import { describe, expect, test } from 'bun:test';

import { normaliseColor } from '../webclone/design-md.js';
import {
  isInvisibleColor, judgeTokenAdherence, renderTokenAdherence,
} from './token-adherence.js';

const judge = (painted: Array<{ value: string; count: number }>, tokens: string[]) =>
  judgeTokenAdherence(painted, tokens, normaliseColor);

describe('isInvisibleColor — 「투명」은 «색»이 아니다', () => {
  test('⛔ 알파 0 을 검정으로 접지 않는다 — 안 칠한 것이 검정으로 센다', () => {
    expect(isInvisibleColor('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isInvisibleColor('rgba(255, 255, 255, 0)')).toBe(true);
    expect(isInvisibleColor('rgba(0, 0, 0, 0%)')).toBe(true);
    expect(isInvisibleColor('transparent')).toBe(true);
  });

  test('알파가 «있는» 색은 보이는 색이다', () => {
    expect(isInvisibleColor('rgba(0, 0, 0, 0.5)')).toBe(false);
    expect(isInvisibleColor('rgb(0, 0, 0)')).toBe(false);
    expect(isInvisibleColor('#000000')).toBe(false);
  });
});

describe('judgeTokenAdherence — 「토큰을 «다 썼나»」가 아니라 「«토큰만» 썼나」', () => {
  test('⭐ 실측 dongne-hanbaqui — `rgb(0,0,0)` 이 글자색 14회인데 토큰엔 `#111111` 뿐이다', () => {
    const r = judge(
      [
        { value: 'rgb(17, 17, 17)', count: 85 },
        { value: 'rgb(112, 112, 112)', count: 65 },
        { value: 'rgb(0, 0, 0)', count: 14 },
        { value: 'rgb(255, 255, 255)', count: 9 },
      ],
      ['#ffffff', '#f5f5f5', '#111111', '#707070', '#9e9e9e'],
    );
    expect(r).not.toBeNull();
    expect(r!.used).toBe(4);
    expect(r!.offToken.map((c) => c.value)).toEqual(['rgb(0, 0, 0)']);
    expect(r!.offTokenHits).toBe(14);
  });

  test('⭐ 많이 칠해진 이탈이 «먼저» 온다 — 고칠 순서가 곧 그 순서다', () => {
    const r = judge(
      [{ value: '#aaaaaa', count: 3 }, { value: '#bbbbbb', count: 40 }],
      ['#111111'],
    );
    expect(r!.offToken.map((c) => c.value)).toEqual(['#bbbbbb', '#aaaaaa']);
  });

  test('같은 색이 여러 자리에 나오면 «한 종»으로 접고 횟수는 «더한다»', () => {
    const r = judge(
      [{ value: 'rgb(0,0,0)', count: 3 }, { value: '#000000', count: 4 }],
      ['#111111'],
    );
    expect(r!.used).toBe(1);
    expect(r!.offTokenHits).toBe(7);
  });

  test('⛔ 투명은 «분모에도 분자에도» 안 들어간다', () => {
    const r = judge(
      [{ value: 'rgba(0, 0, 0, 0)', count: 99 }, { value: '#111111', count: 2 }],
      ['#111111'],
    );
    expect(r!.used).toBe(1);
    expect(r!.offToken).toEqual([]);
  });

  test('⛔ 토큰이 «하나도» 없으면 못 쟀음(null)이다 — 「전부 이탈」이 아니다', () => {
    expect(judge([{ value: '#123456', count: 1 }], [])).toBeNull();
    // 토큰이 색으로 «안 풀리는» 것뿐이어도 같다(폰트 스택 따위).
    expect(judge([{ value: '#123456', count: 1 }], ['-apple-system, sans-serif'])).toBeNull();
  });

  test('⛔ 칠한 색을 «하나도» 못 읽으면 못 쟀음이다 — 「이탈 0」이 아니다', () => {
    expect(judge([], ['#111111'])).toBeNull();
    expect(judge([{ value: 'rgba(0,0,0,0)', count: 5 }], ['#111111'])).toBeNull();
  });

  test('전부 토큰에서 왔으면 이탈 0 이다', () => {
    const r = judge([{ value: 'rgb(17,17,17)', count: 5 }], ['#111111']);
    expect(r!.offToken).toEqual([]);
    expect(r!.ratio).toBe(0);
  });
});

describe('renderTokenAdherence — 「못 쟀음」을 「0」으로 쓰지 않는다', () => {
  test('null 은 «못 쟀다»로 말한다', () => {
    expect(renderTokenAdherence(null)).toContain('못 쟀다');
    expect(renderTokenAdherence(null)).toContain('이탈 0」이 아니다');
  });

  test('이탈이 있으면 «값과 횟수»를 낸다 — 수만 내면 고칠 수 없다', () => {
    const line = renderTokenAdherence(judge([{ value: 'rgb(0, 0, 0)', count: 14 }, { value: '#111111', count: 3 }], ['#111111']));
    expect(line).toContain('rgb(0, 0, 0)(14회)');
    expect(line).toContain('50.0%');
  });
});
