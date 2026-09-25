/**
 * seed-motion.ts — ***씨앗의 「움직임」을 «되읽어» 다시 낼 수 있게 만든다.***
 *
 * ⛔⭐ 왜 있나 — 53차에 «읽는» 축(`keyframes.ts`·`state-motion.ts`)이 섰는데
 *    ***생성기(`seed-to-css.ts`)는 모션을 한 줄도 안 냈다***. ⇒ 「잴 수 있는데 다시 못 짓는다」.
 *    그 간극이 이 저장소가 늘 경계하는 모양이다 — ***「있다」와 「닿는다」***.
 *
 * ⛔ 규율 — ***없는 것을 지어내지 않는다.*** 절이 없으면 `null`,
 *    단계가 비었으면 그 단계를 «안 낸다»(빈 규칙은 CSS 에서 아무 뜻도 없다).
 */

export interface SeedKeyframeStep {
  readonly offset: string;
  readonly declarations: readonly string[];
}

export interface SeedKeyframe {
  readonly name: string;
  readonly steps: readonly SeedKeyframeStep[];
  /**
   * ⭐ 원본에서 이 움직임을 «쓰던» 선택자들.
   * ⛔ 생성기는 이것을 «규칙으로» 내지 않는다 — 그건 원본의 «구현»을 베끼는 일이다.
   *    대신 «주석»으로 남긴다: 「움직임은 여기 있다, 어디에 붙일지는 사람이 정한다」.
   */
  readonly usedIn: readonly string[];
}

/** ⛔ `### 키프레임` 절이 «없으면» `null` — 「움직임이 없다」와 다른 값이다. */
export function readSeedKeyframes(seed: string): SeedKeyframe[] | null {
  const heading = /^###\s+키프레임[^\n]*$/m.exec(seed);
  if (heading === null) return null;
  const body = seed.slice(heading.index + heading[0].length).split(/^#{1,6}\s/m, 1)[0];
  const out: SeedKeyframe[] = [];
  let current: { name: string; steps: SeedKeyframeStep[]; usedIn: string[] } | null = null;
  for (const line of body.split('\n')) {
    const head = /^-\s+`([^`]+)`\s+—\s+규칙\s+\d+개가\s+쓴다(.*)$/.exec(line);
    if (head) {
      if (current && current.steps.length) out.push(current);
      current = {
        name: head[1],
        steps: [],
        usedIn: [...head[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]),
      };
      continue;
    }
    // ⛔ 「정의만 되고 안 쓰이는」 목록 줄에 걸리지 않게 «들여쓴 단계 줄»만 받는다.
    const step = /^\s{2,}-\s+([^:⭐][^:]*):\s*(.+)$/.exec(line);
    if (step && current) {
      const offset = step[1].trim();
      const declarations = step[2].split(';').map((d) => d.trim()).filter((d) => d !== '');
      // ⛔ `(선언 없음)` 은 «선언이 아니다» — 빈 규칙을 내지 않는다.
      if (declarations.length === 0 || declarations[0] === '(선언 없음)') continue;
      current.steps.push({ offset, declarations });
      continue;
    }
    if (/^\S/.test(line) && !line.startsWith('-') && current && current.steps.length) {
      out.push(current);
      current = null;
    }
  }
  if (current && current.steps.length) out.push(current);
  return out;
}

/**
 * `@keyframes` 블록을 «그대로» 낸다.
 * ⛔ 이름을 «바꾸지» 않는다 — 씨앗의 이름이 근거고, 바꾸면 대조가 끊긴다.
 */
export function renderKeyframesCss(frames: readonly SeedKeyframe[]): string[] {
  const L: string[] = [];
  for (const frame of frames) {
    if (frame.usedIn.length) {
      // ⛔ 규칙이 «아니라» 주석이다 — 원본의 클래스 이름을 다시 짓지 않는다.
      L.push(`/* 원본에서 ${frame.usedIn.map((s) => `\`${s}\``).join(', ')} 가 썼다 — 여기 붙이는 것은 사람이 정한다 */`);
    }
    L.push(`@keyframes ${frame.name} {`);
    for (const step of frame.steps) L.push(`  ${step.offset} { ${step.declarations.join('; ')}; }`);
    L.push('}');
  }
  return L;
}

/**
 * 가속 곡선을 토큰으로.
 * ⛔⭐ ***이름을 «지어내지» 않는다*** — 씨앗은 「이 곡선이 «무엇»인가」를 모른다(관측은 값뿐).
 *    그래서 `--ease-1`, `--ease-2` 처럼 «번호»를 준다. 이름은 사람이 채운다.
 */
export function renderEasingTokens(easings: readonly string[]): string[] {
  return easings.map((easing, i) => `  --ease-${i + 1}: ${easing};`);
}
