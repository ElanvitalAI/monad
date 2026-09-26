// 사용자 프로젝트 안에 만든 `.elanous/`(디버그 로그·골 문서)를 그 저장소의 «로컬» 무시 목록에 올린다.
//
// 🩸 2026-09-26 베어 Ubuntu 26.04 실측(UX 13): 새 저장소에서 `elanous` 를 켜자 `git status` 가 `?? .elanous/` 로 더러워졌다
//   (상태줄 `⌥ main *1`). 사용자 `.gitignore` 를 고치는 것은 남의 파일을 바꾸는 일이라, 커밋되지 않는
//   `.git/info/exclude` 에만 한 줄을 넣는다.
// ⛔ fail-soft — 무시 목록을 못 써도 로그·골 문서 쓰기는 막지 않는다. git 저장소가 아니거나(.git 없음)
//   워크트리(.git 이 파일)면 아무것도 안 한다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENTRY = '/.elanous/';

export function excludeProjectDotElanous(projectRoot: string): 'added' | 'present' | 'not-a-repo' | 'failed' {
  try {
    const gitDir = join(projectRoot, '.git');
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return 'not-a-repo';
    const infoDir = join(gitDir, 'info');
    const exclude = join(infoDir, 'exclude');
    const body = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (body.split('\n').some((line) => ['/.elanous/', '.elanous/', '/.elanous', '.elanous'].includes(line.trim()))) return 'present';
    mkdirSync(infoDir, { recursive: true });
    appendFileSync(exclude, `${body && !body.endsWith('\n') ? '\n' : ''}# elanous 가 이 저장소 안에 만드는 로컬 산출물(디버그 로그·골 문서) — 자동 추가\n${ENTRY}\n`);
    return 'added';
  } catch {
    return 'failed';
  }
}
