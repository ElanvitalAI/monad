#!/usr/bin/env bun
// 운영 기계 이행 — 옛 이름 monad 의 «저장소 밖» 상태를 elanous 로 옮긴다(브랜드 개명 · 내부 문서 `DECISION-brand-elanous-2026-09-26`).
//
// ⭐ 기본은 드라이런 — 할 일을 줄마다 찍는다. `--apply` 일 때만 한다.
// ⭐ 손대는 설정 파일은 전부 먼저 백업한다(`~/.elanous-migration-backup-<시각>/`).
// ⭐ 재실행 가능 — 이미 옮긴 것은 건너뛴다.
//
// 하는 일(순서):
//   ① 옛 launchd 서비스(com.monad.*)를 내린다 — 새 서비스는 새 설치본으로 `elanous nexus install --launchd` 등이 깐다.
//   ② 폴더를 옮긴다: ~/.monad → ~/.elanous · ~/.local/share/monad → elanous · ~/.local/share/monad-ops → elanous-ops
//      그리고 옛 자리에 심볼릭 링크를 남긴다 — 워크트리 수백 개의 git 메타가 «절대 경로»를 들고 있어서(끊으면 전부 깨진다).
//   ③ 상태 폴더 안에서 코드가 «이름으로» 찾는 파일을 새 이름으로(monad.log·.pid·.sock·.runtime.json·monad-auth.json·bin/monad-backup.sh).
//   ④ 텍스트 설정을 개명 규칙으로 고쳐 쓴다: crontab · ~/.claude/settings.json · ~/.claude.json(MCP 서버 이름) · ~/.codex/config.toml · ~/.zshrc.
// ⛔ 하지 않는 것: 새 설치본 설치 · 새 서비스 설치 · 원격 기계. 그것은 이 스크립트 «뒤»의 단계다(찍어 준다).
// ⛔ 이 파일은 개명 도구의 제외 목록에 있다 — 옛 이름이 곧 입력이다.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rebrandText } from './rebrand-elanous.js';

export interface Step { name: string; detail: string; run: () => void }

export interface MigrateOptions {
  home?: string; now?: Date; uid?: number;
  launchctl?: (args: string[]) => number;
  crontab?: { read: () => string | null; write: (body: string) => void };
  /** 새 판 묶음(.tgz) — 주면 폴더 이동 «뒤» 설치하고 서비스를 새 이름으로 다시 올린다. 안 주면 서비스는 내린 채로 둔다. */
  tgz?: string;
  /** 설치기(개명된 트리의 scripts/install.sh). */
  installer?: string;
  run?: (cmd: string, args: string[]) => number;
}

const STATE_FILE_RENAMES: Array<[string, string]> = [
  ['monad.log', 'elanous.log'],
  ['monad.pid', 'elanous.pid'],
  ['monad.sock', 'elanous.sock'],
  ['monad.runtime.json', 'elanous.runtime.json'],
  ['monad-auth.json', 'elanous-auth.json'],
  ['bin/monad-backup.sh', 'bin/elanous-backup.sh'],
];

function isSymlink(p: string): boolean { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }

export function planMigration(o: MigrateOptions = {}): { steps: Step[]; backupDir: string } {
  const home = o.home ?? homedir();
  const stamp = (o.now ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 15);
  const backupDir = join(home, `.elanous-migration-backup-${stamp}`);
  const uid = o.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 501);
  const launchctl = o.launchctl ?? ((args: string[]) => spawnSync('launchctl', args, { stdio: 'ignore' }).status ?? 1);
  const crontab = o.crontab ?? {
    read: () => { const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout : null; },
    write: (body: string) => { const r = spawnSync('crontab', ['-'], { input: body, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`crontab 쓰기 실패: ${r.stderr}`); },
  };
  const backup = (p: string) => {
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(p, join(backupDir, p.replace(home, '').replace(/^\//, '').replace(/\//g, '__')));
  };
  const steps: Step[] = [];

  // ① 옛 launchd 서비스
  const agents = join(home, 'Library', 'LaunchAgents');
  const oldPlists = existsSync(agents) ? readdirSync(agents).filter((f) => /^com\.monad\.[^.]+\.plist$/.test(f)) : [];
  const newPlists: Array<[string, string]> = [];   // [새 파일 이름, 개명된 본문] — 설치 «뒤»에 올린다
  for (const f of oldPlists) {
    const label = f.replace(/\.plist$/, '');
    if (!/\.plist$/.test(f)) continue;
    newPlists.push([rebrandText(f), rebrandText(readFileSync(join(agents, f), 'utf8'))]);
    steps.push({
      name: 'launchd-down', detail: `${label} 내리고 plist 를 백업 폴더로 옮김`,
      run: () => { launchctl(['bootout', `gui/${uid}/${label}`]); mkdirSync(backupDir, { recursive: true }); renameSync(join(agents, f), join(backupDir, f)); },
    });
  }

  // ② 폴더 이동 ⊕ 옛 자리에 링크
  const moves: Array<[string, string]> = [
    [join(home, '.monad'), join(home, '.elanous')],
    [join(home, '.local', 'share', 'monad'), join(home, '.local', 'share', 'elanous')],
    [join(home, '.local', 'share', 'monad-ops'), join(home, '.local', 'share', 'elanous-ops')],
    [join(home, 'Movies', 'monad-ad'), join(home, 'Movies', 'elanous-ad')],   // 광고 파이프라인 산출 폴더(코드가 새 이름으로 찾는다)
  ];
  for (const [from, to] of moves) {
    if (!existsSync(from) || isSymlink(from)) continue;   // 없거나 이미 옮겨 링크만 남은 것
    if (existsSync(to)) {
      // 상태 폴더만 «합치기 금지»로 멈춘다. 설치 폴더는 새 설치기가 이미 새 자리에 깔았을 수 있다(공개 사용자 순서:
      // 설치 → 이행) — 그때 옛 설치 폴더는 그대로 둔다(doctor 초록 뒤 지워도 된다).
      if (from === join(home, '.monad')) { steps.push({ name: 'move-blocked', detail: `⛔ ${to} 가 이미 있다 — ${from} 를 옮기지 않는다(손으로 합칠 것)`, run: () => { throw new Error(`${to} 가 이미 있다`); } }); continue; }
      steps.push({ name: 'keep-old', detail: `${to} 가 이미 있다 — ${from} 는 그대로 둔다(새 설치가 먼저 깔렸다)`, run: () => {} });
      continue;
    }
    steps.push({ name: 'move', detail: `${from} → ${to} (옛 자리에 링크)`, run: () => { renameSync(from, to); symlinkSync(to, from); } });
  }

  // ③ 상태 폴더 안 이름으로 찾는 파일
  const stateNew = join(home, '.elanous');
  const stateNow = existsSync(join(home, '.monad')) && !isSymlink(join(home, '.monad')) ? join(home, '.monad') : stateNew;
  for (const [a, b] of STATE_FILE_RENAMES) {
    if (!existsSync(join(stateNow, a)) || existsSync(join(stateNow, b))) continue;
    steps.push({ name: 'state-file', detail: `상태 폴더 ${a} → ${b}`, run: () => renameSync(join(stateNew, a), join(stateNew, b)) });
  }

  // ③-b 새 판 설치(개명된 트리의 설치기로) — 폴더 이동 «뒤»라 새 접두(~/.local/share/elanous)에 판이 하나 더 는다.
  const run = o.run ?? ((cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1);
  if (o.tgz) {
    const installer = o.installer ?? join(process.cwd(), 'scripts', 'install.sh');
    steps.push({ name: 'install', detail: `새 판 설치 ${o.tgz} (${installer})`, run: () => { const rc = run('bash', [installer, '--source', o.tgz!, '--no-modify-path']); if (rc !== 0) throw new Error(`설치 실패 rc=${rc}`); } });
  }

  // ③-c 상태 폴더 최상위 설정(json·env) — 코드가 읽는 키·값에 옛 이름이 있다(identity 의 id 키 · autopilot backend · APNs bundleId 등).
  //   밖에 저장된 이름(봇 사용자 이름·Pushcut·S3 접두)은 개명 규칙의 보호 목록이 지킨다.
  if (existsSync(stateNow)) {
    for (const f of readdirSync(stateNow)) {
      if (!/\.(json|env|toml|ya?ml)$/.test(f)) continue;
      const p = join(stateNow, f);
      try { if (!lstatSync(p).isFile()) continue; } catch { continue; }
      const before = readFileSync(p, 'utf8');
      const after = rebrandText(before);
      if (after === before) continue;
      steps.push({ name: 'state-config', detail: `상태 폴더 ${f} 개명 규칙으로 고쳐 씀`, run: () => { const q = join(stateNew, f); backup(q); writeFileSync(q, after); } });
    }
  }

  // ④ 텍스트 설정
  const textFiles = [join(home, '.claude', 'settings.json'), join(home, '.codex', 'config.toml'), join(home, '.zshrc')];
  for (const p of textFiles) {
    if (!existsSync(p)) continue;
    const before = readFileSync(p, 'utf8');
    const after = rebrandText(before);
    if (after === before) continue;
    steps.push({ name: 'rewrite', detail: `${p} 개명 규칙으로 고쳐 씀`, run: () => { backup(p); writeFileSync(p, after); } });
  }
  // ~/.claude.json 은 크고 대화 이력 경로를 품는다 — MCP 서버 항목만 고친다(키 이름 ⊕ 그 값).
  const claudeJson = join(home, '.claude.json');
  if (existsSync(claudeJson)) {
    const d = JSON.parse(readFileSync(claudeJson, 'utf8')) as { mcpServers?: Record<string, unknown>; projects?: Record<string, { mcpServers?: Record<string, unknown> }> };
    const fix = (m?: Record<string, unknown>) => {
      if (!m) return 0;
      let n = 0;
      for (const k of Object.keys(m)) {
        const nk = rebrandText(k);
        const nv = JSON.parse(rebrandText(JSON.stringify(m[k])));
        if (nk !== k || JSON.stringify(nv) !== JSON.stringify(m[k])) { delete m[k]; m[nk] = nv; n++; }
      }
      return n;
    };
    let n = fix(d.mcpServers);
    for (const p of Object.values(d.projects ?? {})) n += fix(p.mcpServers);
    if (n) steps.push({ name: 'rewrite', detail: `${claudeJson} MCP 서버 항목 ${n}개`, run: () => { backup(claudeJson); writeFileSync(claudeJson, JSON.stringify(d, null, 2)); } });
  }
  const cron = crontab.read();
  if (cron !== null) {
    const after = rebrandText(cron);
    if (after !== cron) {
      const changed = cron.split('\n').filter((l, i) => l !== after.split('\n')[i]).length;
      steps.push({
        name: 'crontab', detail: `crontab ${changed}줄 개명 규칙으로 고쳐 씀`,
        run: () => { mkdirSync(backupDir, { recursive: true }); writeFileSync(join(backupDir, 'crontab.before'), cron); crontab.write(after); },
      });
    }
  }
  // ⑤ 서비스를 새 이름으로 다시 올린다 — 새 판이 깔린 뒤에만(안 그러면 KeepAlive 가 없는 경로를 되풀이한다).
  if (o.tgz) {
    for (const [name, body] of newPlists) {
      const label = name.replace(/\.plist$/, '');
      steps.push({
        name: 'launchd-up', detail: `${label} 새 이름으로 설치·기동`,
        run: () => { writeFileSync(join(agents, name), body); launchctl(['bootstrap', `gui/${uid}`, join(agents, name)]); },
      });
    }
  }
  return { steps, backupDir };
}

export const NEXT_STEPS = [
  '(--tgz 를 안 줬다면) 새 판 설치 뒤 이 스크립트를 --tgz 로 다시 돌려 서비스를 올린다',
  '운영 체크아웃(~/.local/share/elanous-ops/monad-agent): git pull ⊕ bun install(루트·apps/pwa) — 크론이 그 트리의 bin/elanous.mjs 를 부른다',
  '전역 명령: ~/.bun/bin/monad 를 지우고 elanous 로 잇는다',
  'elanous doctor · 넥서스 응답 · 텔레그램 봇 한 마디 · 크론 첫 판 로그',
];

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const at = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const { steps, backupDir } = planMigration({ tgz: at('--tgz'), installer: at('--installer') });
  console.log(`${apply ? '적용' : '드라이런'} — ${steps.length}단계 · 백업 ${backupDir}`);
  for (const s of steps) {
    console.log(`  [${s.name}] ${s.detail}`);
    if (apply) s.run();
  }
  console.log('다음(이 스크립트 밖):');
  for (const n of NEXT_STEPS) console.log(`  · ${n}`);
}
