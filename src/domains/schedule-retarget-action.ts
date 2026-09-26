// ── schedule retarget — crontab `cd <folder>` 일괄 교체 (R3·S4) ──────────
//
// `elanous schedule retarget --from <folder> --to <folder> [--yes] [--json]`
// 의 액션. 시스템 crontab 에서 선두 `cd <from>` 만 `<to>` 로 바꾼다.
// 기본은 dry-run. `--yes` 일 때만 백업 후 적용.
// 대상 폴더가 디렉터리가 아니면 에러(crontab 무접촉).

import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  applyCrontab,
  inventoryCrontab,
  listSchedules,
  openSchedulesDb,
  parseCronLine,
  readCrontab,
} from './schedule-registry.js';

export interface ScheduleRetargetInput {
  from?: string;
  to?: string;
  /** true 면 적용. 기본 dry-run. */
  yes?: boolean;
  /** 이 잡들만(쉼표 구분 · `elanous schedule list` 의 id 접두 또는 이름). 생략하면 폴더가 같은 줄 전부. */
  only?: string;
}

export interface ScheduleRetargetChange {
  before: string;
  after: string;
}

export type ScheduleRetargetResult =
  | {
      dryRun: true;
      from: string;
      to: string;
      count: number;
      changes: ScheduleRetargetChange[];
      note: string;
    }
  | {
      dryRun: false;
      from: string;
      to: string;
      count: number;
      changes: ScheduleRetargetChange[];
      backup: string;
      note: string;
    }
  | { error: string };

/** 선두 `cd <path>` 의 path 토큰. 인용부 허용. 없으면 null. */
export function leadingCdPath(command: string): { raw: string; start: number; end: number } | null {
  const match = command.match(/^cd\s+("([^"]*)"|'([^']*)'|(\S+))/);
  if (!match || match.index === undefined) return null;
  const raw = match[2] ?? match[3] ?? match[4] ?? '';
  return { raw, start: match.index, end: match.index + match[0].length };
}

/** 크론 명령에 «그대로» 들어가도 셸·cron 이 다르게 읽지 않는 문자만(`;` `$` 백틱 `%` 공백 개행 등은 거부). */
const SAFE_CRON_PATH = /^\/[A-Za-z0-9._@+\/-]*$/;

function sameFolder(a: string, b: string): boolean {
  // ⛔ 상대 경로는 비교하지 않는다 — CLI 의 현재 폴더와 cron 의 작업 폴더가 달라 «다른 폴더»를 같다고 읽는다.
  if (!isAbsolute(a) || !isAbsolute(b)) return false;
  if (a === b) return true;
  try {
    return resolve(a) === resolve(b);
  } catch {
    return false;
  }
}

function retargetCommand(command: string, from: string, to: string): string | null {
  const cd = leadingCdPath(command);
  if (!cd) return null;
  if (!sameFolder(cd.raw, from)) return null;
  return `cd ${to}${command.slice(cd.end)}`;   // `to` 는 SAFE_CRON_PATH 를 통과한 값만 온다
}

function assertDirectory(folder: string, label: 'from' | 'to'): string | null {
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(folder);
  } catch {
    return label === 'to'
      ? `대상 폴더가 없습니다: ${folder}`
      : `원본 폴더가 없습니다: ${folder}`;
  }
  if (!info.isDirectory()) {
    return label === 'to'
      ? `대상 경로가 디렉터리가 아닙니다: ${folder}`
      : `원본 경로가 디렉터리가 아닙니다: ${folder}`;
  }
  return null;
}

function defaultRows(): Array<{ id: string; name: string; raw: string | null }> {
  const db = openSchedulesDb();
  try { return listSchedules(db).map((r) => ({ id: r.id, name: r.name, raw: r.raw })); }
  finally { db.close(); }
}

/** crontab 의 `cd <from>` 을 `cd <to>` 로 교체. 기본 dry-run. */
export function retargetScheduleFolders(
  input: ScheduleRetargetInput,
  deps: {
    read?: () => string;
    apply?: (text: string) => string;
    inventory?: () => void;
    /** `--only` 해석용 레지스트리 행(id·이름·원본 줄). 기본 = schedules.db. */
    rows?: () => ReadonlyArray<{ id: string; name: string; raw: string | null }>;
  } = {},
): ScheduleRetargetResult {
  const from = input.from?.trim() ?? '';
  const to = input.to?.trim() ?? '';
  if (!from || !to) return { error: 'retarget에는 --from <folder> 와 --to <folder> 가 필요합니다.' };
  if (!isAbsolute(from) || !isAbsolute(to)) return { error: '--from 과 --to 는 절대 경로여야 합니다(cron 은 CLI 와 다른 폴더에서 돈다).' };
  if (!SAFE_CRON_PATH.test(to)) return { error: `--to 에 크론 명령으로 안전하지 않은 문자가 있습니다(허용: 영숫자 . _ @ + / -): ${JSON.stringify(to)}` };
  if (sameFolder(from, to)) return { error: '--from 과 --to 가 같은 폴더입니다.' };

  const fromErr = assertDirectory(from, 'from');
  if (fromErr) return { error: fromErr };
  const toErr = assertDirectory(to, 'to');
  if (toErr) return { error: toErr };

  // `--only` — 레지스트리 id(접두)·이름으로 고른 잡의 «원본 줄»만 바꾼다. 못 찾은 선택자가 하나라도 있으면 아무것도 안 바꾼다.
  let onlyLines: Set<string> | undefined;
  const selectors = (input.only ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (selectors.length > 0) {
    const rows = (deps.rows ?? defaultRows)();
    onlyLines = new Set();
    const missing: string[] = [];
    for (const sel of selectors) {
      const hits = rows.filter((r) => r.id.startsWith(sel) || r.name === sel);
      if (hits.length !== 1) { missing.push(`${sel}(${hits.length}건)`); continue; }
      if (hits[0]!.raw) onlyLines.add(hits[0]!.raw.trim());
    }
    if (missing.length > 0) return { error: `--only 선택자가 잡 «하나»에 맞지 않습니다: ${missing.join(', ')} — elanous schedule list 의 id 로 고르십시오.` };
  }

  const current = (deps.read ?? readCrontab)();
  const changes: ScheduleRetargetChange[] = [];
  const nextLines = current.split('\n').map((line) => {
    const parsed = parseCronLine(line);
    if (!parsed) return line;
    if (onlyLines && !onlyLines.has(line.trim())) return line;
    const nextCommand = retargetCommand(parsed.command, from, to);
    if (!nextCommand || nextCommand === parsed.command) return line;
    const after = `${parsed.cron} ${nextCommand}`;
    changes.push({ before: line.trim(), after });
    return after;
  });

  if (changes.length === 0) {
    return {
      dryRun: true,
      from,
      to,
      count: 0,
      changes,
      note: '교체할 cd 줄이 없습니다. crontab 은 변경하지 않았습니다.',
    };
  }

  if (input.yes !== true) {
    return {
      dryRun: true,
      from,
      to,
      count: changes.length,
      changes,
      note: `${changes.length}건 cd 교체 예정 — 적용하려면 --yes (백업 자동·crontab 재작성).`,
    };
  }

  const text = nextLines.join('\n').replace(/\n*$/, '\n');
  const backup = (deps.apply ?? applyCrontab)(text);
  if (deps.inventory) deps.inventory();
  else {
    const db = openSchedulesDb();
    try { inventoryCrontab(db, { crontab: text }); }
    finally { db.close(); }
  }
  return {
    dryRun: false,
    from,
    to,
    count: changes.length,
    changes,
    backup,
    note: `${changes.length}건 cd 를 ${to} 로 교체했습니다(백업 완료).`,
  };
}
