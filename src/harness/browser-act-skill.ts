/**
 * 🎬→📜 **궤적을 «스킬»로 굳힌다** (RFC §23b · P⑦ · §26 H9)
 *
 * ⛔⭐⭐ **이 파일의 본체는 「변환」이 아니라 «경계»다.**
 *    §23b 가 못 박았다: *"그 스킬은 되돌릴 수 없는 조작을 담을 수 있다 ⇒ C5 의 관문을
 *    **굳힐 때 «같이» 박아 넣어야** 한다. 그것 없이 열면 「학습된 자동 클릭」이 무경계로 돈다."*
 *
 * ⇒ 그래서 이 변환기는 «거절»부터 한다:
 * ```
 *   걸음 0            굳힐 것이 없다
 *   잘린 궤적          «부분»을 «전부»로 굳히지 않는다 — 상한에 닿았으면 거절한다
 *   성공한 걸음 0      실패만 있는 궤적은 「할 일」이 아니라 「하려 했던 일」이다
 *   페르소나 없음      경계가 페르소나에 붙으므로, 주인 없는 궤적은 굳히지 않는다
 * ```
 * ⭐ 그리고 굳힌 스킬은 «자기 출처»를 밝힌다 — 어느 봇의 · 몇 걸음 · 언제 것인가.
 */

import type { TrajectoryStep } from './browser-act-trajectory.js';

export interface SkillFreezeInput {
  /** 스킬 이름 — 파일·프론트매터에 그대로 쓴다. */
  name: string;
  steps: readonly TrajectoryStep[];
  /** ⛔ 궤적 조회가 상한에 닿았나. 닿았으면 굳히지 않는다. */
  truncated: boolean;
  /** 그 페르소나에 이미 선언된 경계(없으면 빈 목록). */
  declaredActionHosts?: readonly string[];
}

export type SkillFreezeResult =
  | { ok: true; md: string; hosts: string[]; steps: number; warnings: string[] }
  | { ok: false; error: string };

/** ⛔ 호스트만 뽑는다 — 경로·쿼리는 경계가 아니다(경계는 «어느 집인가»다). */
export function hostOf(url: string): string | null {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return null; }
}

/** 이름을 파일·프론트매터에 쓸 수 있게 좁힌다. ⛔ 조용히 고치지 않고, 못 쓰면 거절한다. */
export function isUsableSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,48}$/.test(name);
}

export function freezeTrajectoryAsSkill(input: SkillFreezeInput): SkillFreezeResult {
  if (!isUsableSkillName(input.name)) {
    return { ok: false, error: `스킬 이름이 «못 쓴다»: ${input.name} — 소문자·숫자·하이픈 2~49자` };
  }
  // ⛔ 「부분」을 「전부」로 굳히지 않는다. 이 거절이 없으면 조용히 반쪽 스킬이 생긴다.
  if (input.truncated) {
    return { ok: false, error: '궤적이 «잘렸다»(조회 상한) — 부분을 전부로 굳히지 않는다. 창을 좁혀 다시 읽어라' };
  }
  if (input.steps.length === 0) return { ok: false, error: '걸음이 «0» 이다 — 굳힐 것이 없다' };

  // ⛔ 실패한 걸음은 「할 일」이 아니다 — 그 순간 «하려 했던» 일의 기록일 뿐이다.
  const good = input.steps.filter((s) => s.ok);
  if (good.length === 0) {
    return { ok: false, error: `성공한 걸음이 «0» 이다(전체 ${input.steps.length}) — 실패만 굳히지 않는다` };
  }

  const personas = new Set(good.map((s) => s.personaId).filter((p): p is string => typeof p === 'string' && p !== ''));
  if (personas.size === 0) {
    return { ok: false, error: '걸음에 «주인(personaId)»이 없다 — 경계가 페르소나에 붙으므로 굳히지 않는다' };
  }
  if (personas.size > 1) {
    return { ok: false, error: `걸음의 주인이 «여럿»이다(${[...personas].join(', ')}) — 한 봇의 궤적만 굳힌다` };
  }
  const personaId = [...personas][0]!;

  // 🚧 경계 — ⛔ 「누른 곳」과 「착지한 곳」을 «둘 다» 모은다. 302 로 밖에 나간 것이 여기서 드러난다.
  const hostSet = new Set<string>();
  for (const s of good) {
    for (const u of [s.url, s.landedUrl ?? undefined]) {
      if (typeof u !== 'string') continue;
      const h = hostOf(u);
      if (h) hostSet.add(h);
    }
  }
  const hosts = [...hostSet].sort();

  const warnings: string[] = [];
  const declared = new Set(input.declaredActionHosts ?? []);
  // ⚠️ 「경계가 «선언되지 않았다»」와 「경계 밖이다」는 다른 값이다 — 둘 다 말한다.
  if (declared.size === 0) {
    warnings.push(`⚠️ ${personaId} 에 actionHosts 가 «선언돼 있지 않다» — 이 스킬을 쓰기 «전»에 위 호스트로 선언하라`);
  } else {
    const outside = hosts.filter((h) => !declared.has(h) && !declared.has(`.${h}`));
    if (outside.length > 0) {
      warnings.push(`⛔ 선언된 경계 «밖»의 호스트가 있다: ${outside.join(', ')} — 굳히기 전에 사람이 판단하라`);
    }
  }
  const skipped = input.steps.length - good.length;
  if (skipped > 0) warnings.push(`⚠️ 실패한 걸음 ${skipped}개는 «안 담았다»(전체 ${input.steps.length})`);

  const first = good[0]!.ts;
  const last = good.at(-1)!.ts;
  const lines: string[] = [
    '---',
    `name: ${input.name}`,
    `description: ${personaId} 의 브라우저 궤적 ${good.length}걸음을 굳힌 것. "${input.name}" 등의 언급 시 이 스킬 사용.`,
    // ⛔⭐ 되돌릴 수 없는 조작을 담을 수 있다 ⇒ ***모델이 스스로 부르지 못한다***.
    'disable-model-invocation: true',
    '---',
    '',
    `# ${input.name} — 굳힌 궤적`,
    '',
    '> ⛔ 이 스킬은 «사람이 판단해» 부른다. 자동 실행하지 않는다.',
    '',
    '## 📜 출처 (⛔ 지어낸 것이 아니라 «녹화»다)',
    '```',
    `봇      ${personaId}`,
    `걸음    ${good.length}${skipped > 0 ? ` (실패 ${skipped}개 제외)` : ''}`,
    `기간    ${first} → ${last}`,
    '```',
    '',
    '## 🚧 경계 — ⛔ 이 스킬이 «닿는» 곳은 이것뿐이다',
    '```',
    ...hosts.map((h) => `  ${h}`),
    '```',
    `⛔ 이 목록을 ${personaId} 의 \`actionHosts\` 에 «선언»하라. 선언하지 않으면 경계가 «막지 않는다».`,
    '',
    '## 🖐️ 걸음',
    '',
  ];
  good.forEach((s, i) => {
    lines.push(`### ${i + 1}. \`${s.target}\``);
    lines.push('```bash');
    lines.push(`bun bin/elanous.mjs harness browser-act ${JSON.stringify(s.url)} ${JSON.stringify(s.target)} \\`);
    lines.push(`  --armed --persona ${personaId}`);
    lines.push('```');
    if (typeof s.landedUrl === 'string' && s.landedUrl !== s.url) {
      lines.push(`⇒ 그때 착지한 곳: ${s.landedUrl}`);
    }
    lines.push('');
  });
  if (warnings.length > 0) {
    lines.push('## ⚠️ 굳힐 때 남은 말', '');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  return { ok: true, md: lines.join('\n'), hosts, steps: good.length, warnings };
}
