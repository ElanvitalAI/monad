import { accessSync, constants, existsSync, statSync } from 'node:fs';

/**
 * ⛔⭐ 「있다」와 「쓸 수 있다」는 «다른 값»이다.
 *
 * 🩸 계기 (2026-09-22 · 🅢 가 다른 축에서 먼저 찾았다):
 *   macOS 설치본에서 doctor 가 `node-pty: found` 라 했는데 `pty.spawn` 이 죽었다.
 *   `chmod +x spawn-helper` 하니 그 오류가 사라졌다 —
 *   ***탐침이 「로드되나」만 묻고 「쓸 수 있나」를 안 물었다.***
 *
 * 📏 같은 구멍이 이 축에도 있었다: `path` 탐침이 `existsSync` 하나였고,
 *   지어낸 음성(존재하지만 `chmod 644` 인 파일)에 «있다»를 냈다.
 *
 * ⛔ 그래서 결과를 «불린으로 접지 않는다» — `not-executable` 은 `missing` 과 다른 값이고,
 *   처방도 다르다(깔아라 ↔ chmod +x 해라).
 */
export type PathProbe = 'ok' | 'missing' | 'not-executable';

export function pathProbe(value: string): PathProbe {
  if (!existsSync(value)) return 'missing';
  // ⛔ `.app` 번들·폴더는 «존재»가 맞는 물음이다 — 「그 앱이 «도나»」는 `drive` 축이 답한다.
  //   폴더에 X_OK 를 물으면 「traverse 가능」이라 거의 항상 참이고, 아무것도 안 가른다.
  if (statSync(value).isDirectory()) return 'ok';
  try {
    accessSync(value, constants.X_OK);
    return 'ok';
  } catch {
    return 'not-executable';
  }
}
