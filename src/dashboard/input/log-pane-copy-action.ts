import type { Key } from '../../tui.js';

/** ⛔⭐ 화음은 «이미 묶인 자리»를 피해 고른다 — 전수 지도 =
 *  `내부 문서 `REFERENCE-alt-chord-map-2026-08-21``.
 *  📏 2026-08-21: 최초 배정 Alt+M·Alt+O·Alt+P 가 각각
 *  프로바이더 회전 · 페인 순환 · 창 전환을 «덮어 죽였다». */

export type LogPaneCopyAction = 'block' | 'all' | 'last-message' | 'last-code' | 'last-media';
type LogPaneKeyAction = LogPaneCopyAction | 'return-to-input';

export function resolveLogPaneCopyAction(key: Key): LogPaneKeyAction | null {
  if (!key.alt || key.ctrl || key.meta) return null;

  if (key.name === 'f' || key.name === 'F' || key.name === 'ㄹ') return 'last-media';
  if (key.name === 'y' || key.name === 'Y' || key.name === 'ㅛ') return 'last-code';
  if (key.name === 'g' || key.name === 'G' || key.name === 'ㅎ') return 'last-message';
  if (key.name === 'b' || key.name === 'B' || key.name === 'ㅠ') return 'block';
  if (key.name === 'a' || key.name === 'A' || key.name === 'ㅁ') return 'all';
  if (key.name === 'u' || key.name === 'U' || key.name === 'ㅕ') return 'return-to-input';
  return null;
}
