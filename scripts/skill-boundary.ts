#!/usr/bin/env bun
/**
 * 스킬 경계 — 「이 스킬은 공개 코어인가, 애드온인가」를 «파생»시킨다 (대표 결정 2026-09-25: 애드온은 별도 패키지).
 *
 * 입력은 둘이다:
 *   skills/<name>/SKILL.md 머리말   `requires: [<자원 id>…]` — 없으면 그 스킬이 일을 못 하는 자원
 *                                    `boundary: addon` ⊕ `boundary_reason` — 자원이 아니라 «묶임»이 이유일 때
 *   scripts/open-core-boundary.ts   자원마다 코어/애드온 판정(자격 축)
 *
 * 판정: `boundary: addon` 이거나 `requires` 중 하나라도 애드온 자원이면 애드온. 나머지는 코어.
 * ⛔ 판정을 저장하지 않는다 — 내보내기가 매번 다시 계산한다(손으로 적은 제외 목록은 늙는다).
 * ⛔ 판정할 수 없는 스킬(머리말 없음·requires 없음·모르는 자원 id)은 «코어로 떨어뜨리지 않고» 오류로 낸다.
 *
 * 쓰는 법:  bun scripts/skill-boundary.ts [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { judgeCredential, loadAssets } from './open-core-boundary.js';

export type SkillVerdict = 'core' | 'addon';
export interface SkillBoundary {
  readonly skill: string;
  readonly verdict: SkillVerdict;
  readonly requires: readonly string[];
  readonly because: string;
}
export interface SkillBoundaryReport {
  readonly skills: readonly SkillBoundary[];
  /** 판정하지 못한 이유 — 비어 있어야 내보내기가 돈다. */
  readonly errors: readonly string[];
}

function frontmatter(text: string): Record<string, unknown> | null {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const body = text.slice(4, end);
  try {
    const parsed = parseYaml(body) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    // 스킬 로더들은 머리말을 관대하게 읽는다(예: 따옴표 없는 설명문 속 `: `). 엄격 YAML 이 거부하면
    // 경계 필드 셋만 «한 줄씩» 읽는다 — 설명문을 고치라고 요구하지 않는다.
    const out: Record<string, unknown> = {};
    for (const line of body.split('\n')) {
      const m = /^(requires|boundary|boundary_reason):\s*(.*)$/u.exec(line);
      if (!m) continue;
      try { out[m[1]!] = parseYaml(m[2]!) as unknown; } catch { out[m[1]!] = m[2]; }
    }
    return out;
  }
}

export function computeSkillBoundaries(root: string): SkillBoundaryReport {
  const { rows } = loadAssets(root);
  const resourceCore = new Map<string, boolean>();
  const requiredFor = new Map<string, string[]>();
  for (const row of rows) {
    const v = judgeCredential(row);
    resourceCore.set(v.id, v.core);
    const rf = (row as { required_for?: unknown }).required_for;
    if (Array.isArray(rf)) for (const s of rf) if (typeof s === 'string') requiredFor.set(s, [...(requiredFor.get(s) ?? []), v.id]);
  }
  const skillsDir = join(root, 'skills');
  const skills: SkillBoundary[] = [];
  const errors: string[] = [];
  const names = existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory()).sort() : [];
  for (const skill of names) {
    const file = join(skillsDir, skill, 'SKILL.md');
    const fm = existsSync(file) ? frontmatter(readFileSync(file, 'utf8')) : null;
    if (!fm) { errors.push(`${skill}: SKILL.md 머리말이 없다`); continue; }
    if (!Array.isArray(fm.requires) || fm.requires.some((r) => typeof r !== 'string')) {
      errors.push(`${skill}: requires 가 없다 — 없어도 되면 requires: [] 로 «적는다»(안 적은 것과 «없다»는 다르다)`);
      continue;
    }
    const requires = fm.requires as string[];
    const unknown = requires.filter((r) => !resourceCore.has(r));
    if (unknown.length) { errors.push(`${skill}: catalog/resources.yaml 에 없는 자원 id — ${unknown.join(', ')}`); continue; }
    // 자원 쪽 `required_for` 는 «쓰는 곳»이다(무료 대체가 있는 코어 자원도 적힌다). 위험한 것은
    // «애드온 자원»을 쓰는데 스킬이 안 적은 경우뿐이다 — 그러면 그 스킬이 코어로 «잘못» 나간다.
    const missing = (requiredFor.get(skill) ?? []).filter((r) => resourceCore.get(r) === false && !requires.includes(r));
    if (missing.length) { errors.push(`${skill}: resources.yaml 의 required_for 가 이 스킬을 가리키는데 requires 에 없다 — ${missing.join(', ')}`); continue; }
    if (fm.boundary !== undefined && fm.boundary !== 'addon' && fm.boundary !== 'core') {
      errors.push(`${skill}: boundary 는 addon|core 만 — ${String(fm.boundary)}`);
      continue;
    }
    if (fm.boundary === 'addon') {
      const reason = typeof fm.boundary_reason === 'string' && fm.boundary_reason.trim() ? fm.boundary_reason.trim() : '';
      if (!reason) { errors.push(`${skill}: boundary: addon 에는 boundary_reason 이 있어야 한다`); continue; }
      skills.push({ skill, verdict: 'addon', requires, because: `boundary: addon — ${reason}` });
      continue;
    }
    const addonResources = requires.filter((r) => resourceCore.get(r) === false);
    if (fm.boundary !== 'core' && addonResources.length) {
      skills.push({ skill, verdict: 'addon', requires, because: `애드온 자원 필요 — ${addonResources.join(', ')}` });
      continue;
    }
    skills.push({ skill, verdict: 'core', requires, because: fm.boundary === 'core' ? 'boundary: core (명시)' : requires.length ? `필요 자원이 모두 코어 — ${requires.join(', ')}` : '필요 자원 없음' });
  }
  return { skills, errors };
}

/** `skills/<name>/…` 파일을 그 스킬의 판정으로 거른다. 스킬 폴더 밖 파일은 그대로 둔다. */
export function filterFilesBySkillVerdict(files: readonly string[], report: SkillBoundaryReport, keep: SkillVerdict): string[] {
  const verdict = new Map(report.skills.map((s) => [s.skill, s.verdict]));
  return files.filter((file) => {
    const m = /^skills\/([^/]+)\//u.exec(file);
    if (!m) return true;
    return verdict.get(m[1]!) === keep;
  });
}

if (import.meta.main) {
  const report = computeSkillBoundaries(process.cwd());
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const s of report.skills) console.log(`${s.verdict.padEnd(5)}  ${s.skill.padEnd(34)} ${s.because}`);
    for (const e of report.errors) console.error(`⛔ ${e}`);
  }
  process.exit(report.errors.length ? 1 : 0);
}
