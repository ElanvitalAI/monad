/** Read-side log axes: stable category groups without changing stored records. */
export const LOG_AXIS_CATEGORIES = {
  dev: [
    'dev-pipeline',
    'self-implement',
    'harness.frontdoor',
    'harness.membrane',
    'harness.sequencer',
  ],
  pty: [
    'pty.takeover',
    'pty.arbiter',
    'pty.spawn',
    'pty.drive',
    'pty.special-key',
    'pty.shell-send',
    'nexus.pty.write.error',
    'nexus.pty.resize.error',
    'nexus.pty.kill.error',
    'pane-spawner.pty.start',
  ],
} as const satisfies Record<string, readonly string[]>;

type LogAxis = keyof typeof LOG_AXIS_CATEGORIES;

/** ⛔ own-property 로만 찾는다 — 일반 객체를 그냥 인덱싱하면 `toString`·`constructor` 같은
 *  **프로토타입 값**이 돌아와 호출부가 그것을 배열로 알고 터진다(무인 리뷰가 실크래시로 잡음).
 *  ⇒ 모르는 축은 반드시 `undefined` 여야 fail-closed 가 성립한다. */
export function resolveLogAxis(axis: string): readonly string[] | undefined {
  return Object.hasOwn(LOG_AXIS_CATEGORIES, axis) ? LOG_AXIS_CATEGORIES[axis as LogAxis] : undefined;
}

export function knownLogAxes(): readonly LogAxis[] {
  return Object.keys(LOG_AXIS_CATEGORIES) as LogAxis[];
}
