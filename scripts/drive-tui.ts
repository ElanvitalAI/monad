// ── External elanous TUI driver (self-dogfood harness · PoC 2026-07-17) ──
//
// 외부 에이전트(Claude Code/Codex)가 elanous TUI 를 100% 실물로 구동·캡처하기
// 위한 드라이버. elanous 의 `pty-shell/registry`(startPty + xterm 에뮬레이터)를
// **라이브러리로 재사용** — elanous-in-elanous 가 아니라 별도 driver 프로세스가
// 실제 elanous TUI 를 PTY 안에서 돌리고 화면을 캡처한다. 구조 무손상.
//
// 사용:
//   bun run scripts/drive-tui.ts                    # 부팅 화면만 캡처(프롬프트 X)
//   bun run scripts/drive-tui.ts "git status 확인"   # 프롬프트 전송 후 캡처
//   bun run scripts/drive-tui.ts "..." --png out.png  # 화면 PNG 도 저장
//
// 캡처 = renderScreen()(텍스트 그리드) + renderScreenPng()(PNG). 입력 =
// write(prompt + Enter). 턴 완료 감지는 화면 안정화(연속 동일 스냅샷) 휴리스틱.

import { startPty, ptyAvailable, type PtyHandle } from '../src/pty-shell/registry.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 전체 PTY 버퍼(snapshot)의 ANSI/제어 시퀀스 제거 → 판독 가능한 평문 트랜스크립트.
function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC
    .replace(/\x1B[P_^X][^\x1B]*\x1B\\/g, '')          // DCS/PM/APC/SOS
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')            // CSI (색·커서·모드)
    .replace(/\x1B[@-Z\\-_=>]/g, '');                   // 그 외 단일 ESC
}

// dogfood 판독 요약 — 툴콜 수(Read/Grep/Bash 분해) + 완료 뱃지(model(effort)) 자동 추출.
// renderScreen(최종 그리드)이 스크롤아웃으로 놓치는 신호를 전체 snapshot 에서 회수한다.
function summarize(clean: string): string {
  const count = (re: RegExp) => (clean.match(re) || []).length;
  const tool = count(/⏺\s+\w+\(/g);
  const reads = count(/⏺\s+Read\(/g);
  const greps = count(/⏺\s+Grep\(/g);
  const bash = count(/⏺\s+(Bash|RunShell)\(/g);
  const edits = count(/⏺\s+(Edit|Write|MultiEdit)\(/g);
  const badge = clean.match(/🧠\s+([\w.\-]+)\(([\w]+)\)/);
  const badgeStr = badge ? `${badge[1]}(${badge[2]})` : '(뱃지 미포착)';
  return `tool-calls=${tool} (Read=${reads} Grep=${greps} Bash=${bash} Edit=${edits}) · 완료뱃지=${badgeStr}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pngIdx = args.indexOf('--png');
  const pngPath = pngIdx >= 0 ? (args[pngIdx + 1] ?? null) : null;
  // 버그수리(2026-07-17): --png 없을 때 pngIdx=-1 → pngIdx+1=0 이 프롬프트(idx 0)를
  // 제거하던 문제. --png 값 인덱스만 정확히 배제.
  const pngValueIdx = pngIdx >= 0 ? pngIdx + 1 : -1;
  // 해상도 — 복잡 TUI(htop·vim·lazygit)도 캡처되게 큰 기본값 + configurable.
  //   --cols N / --rows N  또는  --size 220x60  또는  env DRIVE_TUI_COLS/ROWS.
  const colsIdx = args.indexOf('--cols');
  const rowsIdx = args.indexOf('--rows');
  const sizeIdx = args.indexOf('--size');
  const sizeArg = sizeIdx >= 0 ? (args[sizeIdx + 1] ?? '') : '';
  const [sizeCols, sizeRows] = sizeArg.includes('x') ? sizeArg.split('x').map(Number) : [];
  const cols = Number(colsIdx >= 0 ? args[colsIdx + 1] : undefined) || sizeCols || Number(process.env.DRIVE_TUI_COLS) || 220;
  const rows = Number(rowsIdx >= 0 ? args[rowsIdx + 1] : undefined) || sizeRows || Number(process.env.DRIVE_TUI_ROWS) || 60;
  // --cmd "<command>" — elanous TUI 대신 임의 명령/TUI 구동(htop·top·vim·lazygit).
  // 이 경우 prompt 없이 boot 캡처 = 그 TUI 화면 캡처. 복잡 TUI 렌더 검증용.
  const cmdIdx = args.indexOf('--cmd');
  const cmdArg = cmdIdx >= 0 ? (args[cmdIdx + 1] ?? '') : '';
  // --test — 격리 인스턴스(<repo>/.elanous-test) 로 elanous TUI 구동. config·state·logs 전부
  // 격리 루트로. 운영 config·세션 무접촉(codex 병리 dogfood 안전). 선행: `bun run
  // bin/elanous.mjs config sync-test` 로 격리 config 시딩(terra/high). (2026-07-19 goal-exec)
  const testMode = args.includes('--test');
  const testDirIdx = args.indexOf('--test-dir');
  const testDir = testDirIdx >= 0 ? (args[testDirIdx + 1] ?? `${process.cwd()}/.elanous-test`) : `${process.cwd()}/.elanous-test`;
  // --wait <sec> — 프롬프트 후 최대 대기(넓은 조사·high-effort codex 는 60s 초과 흔함). 기본 90.
  const waitIdx = args.indexOf('--wait');
  const waitSec = Number(waitIdx >= 0 ? args[waitIdx + 1] : undefined) || 90;
  // --boot <sec> — 부팅 settle. 기본 6.
  const bootIdx = args.indexOf('--boot');
  const bootSec = Number(bootIdx >= 0 ? args[bootIdx + 1] : undefined) || 6;
  // --transcript <path> — 전체 PTY 트랜스크립트(ANSI strip) 저장. renderScreen 은 최종 그리드만
  // 잡아 긴 런은 툴콜이·짧은 런은 완료 뱃지가 스크롤아웃된다. snapshot() 전체 버퍼로 회수.
  const transcriptIdx = args.indexOf('--transcript');
  const transcriptPath = transcriptIdx >= 0 ? (args[transcriptIdx + 1] ?? null) : null;
  // --logs — 실행 후 격리 logs.db(tool-loop/브레이크) best-effort 덤프(격리 데몬 가동 시).
  const logsMode = args.includes('--logs');
  // --workdir <dir> — codex 파일작업이 일어날 작업디렉토리(실 워킹트리 오염 방지·feature 구현 dogfood).
  // --worktree — disposable git worktree 자동생성(.elanous-test/worktrees·gitignore)해 그 안에서 구동.
  //   둘 중 하나면 bin/elanous.mjs 는 repo 절대경로로 실행(main node_modules 해석)·cwd 만 workdir 로.
  const workdirIdx = args.indexOf('--workdir');
  const explicitWorkdir = workdirIdx >= 0 ? (args[workdirIdx + 1] ?? null) : null;
  const autoWorktree = args.includes('--worktree');
  // --prompt-file <path> — 프롬프트를 파일에서 읽는다(멀티라인 전문·따옴표 이스케이프 회피).
  //   자연어 골 전문을 그대로 던질 때 필수. inline arg 프롬프트보다 우선.
  const promptFileIdx = args.indexOf('--prompt-file');
  const promptFile = promptFileIdx >= 0 ? (args[promptFileIdx + 1] ?? null) : null;
  const optionIdxs = new Set([pngIdx, pngValueIdx, colsIdx, colsIdx + 1, rowsIdx, rowsIdx + 1, sizeIdx, sizeIdx + 1, cmdIdx, cmdIdx + 1, waitIdx, waitIdx + 1, bootIdx, bootIdx + 1, transcriptIdx, transcriptIdx + 1, workdirIdx, workdirIdx + 1, promptFileIdx, promptFileIdx + 1].filter(i => i >= 0));
  const prompt = promptFile ? readFileSync(promptFile, 'utf8') : (args.find((a, i) => !a.startsWith('--') && !optionIdxs.has(i)) ?? null);
  // --paste — 프롬프트를 bracketed paste(CSI 200~ … CSI 201~)로 전송 = 클립보드 붙여넣기 등가.
  //   멀티라인 전문의 내부 \n 이 조기 Enter(제출)로 새는 걸 막는다(elanous TUI 는 200~/201~ 사이를
  //   pasteBuf 로 누적·미제출, 마지막 \r 로만 제출 — src/tui.ts:218 · chat/index.ts:1492). 멀티라인이면 자동 ON.
  const pasteMode = args.includes('--paste') || (prompt?.includes('\n') ?? false);
  // spawn 대상: --cmd 있으면 그 명령(sh -c 로 파이프/인자 지원), 없으면 elanous TUI.
  // 격리 플래그는 Commander 이전에 파싱되므로(src/index.ts:2-12) elanous TUI args 최상단에.
  const isoArgs = testMode ? ['--config-dir', testDir, '--test-state-dir', testDir] : [];
  // 작업디렉토리 해석 — --worktree 면 disposable worktree 생성, --workdir 면 그 경로, 아니면 repo.
  const repoRoot = process.cwd();
  let workdir = repoRoot;
  if (explicitWorkdir) {
    workdir = explicitWorkdir.startsWith('/') ? explicitWorkdir : `${repoRoot}/${explicitWorkdir}`;
  } else if (autoWorktree) {
    workdir = `${repoRoot}/.elanous-test/worktrees/drive-${Date.now()}`;
    execFileSync('git', ['worktree', 'add', '--detach', workdir, 'HEAD'], { cwd: repoRoot, stdio: 'inherit' });
    console.error(`[drive-tui] worktree 생성: ${workdir}\n[drive-tui] 정리: git worktree remove --force ${workdir}`);
  }
  const worktreeMode = workdir !== repoRoot;
  // worktree/외부 workdir 면 bin 을 repo 절대경로로(main node_modules 해석)·cwd 만 workdir 로.
  const binPath = worktreeMode ? `${repoRoot}/bin/elanous.mjs` : 'bin/elanous.mjs';
  const spawn = cmdArg
    ? { cmd: 'sh', args: ['-c', cmdArg] }
    : { cmd: 'bun', args: [binPath, ...isoArgs] };
  if (testMode) console.error(`[drive-tui] --test 격리: config·state·logs → ${testDir}`);
  if (worktreeMode) console.error(`[drive-tui] 작업디렉토리(codex 편집 대상): ${workdir}`);

  if (!ptyAvailable()) {
    console.error('PTY unavailable (node-pty / bun-native 둘 다 없음)');
    process.exit(1);
  }

  console.error(`[drive-tui] spawning ${cmdArg || 'elanous TUI'} in a PTY (${cols}x${rows})…`);
  const h: PtyHandle = startPty({
    cmd: spawn.cmd,
    args: spawn.args,
    cols,
    rows,
    workdir,
    // rich VW 는 essential 이라 안 뜨지만, 텍스트 채팅 UI 는 PTY 에서 렌더됨.
    env: { ...process.env, ELANOUS_DRIVE_TUI: '1', ...(testMode ? { ELANOUS_STATE_DIR: testDir } : {}) },
  });

  // 부팅 대기 — 최소 6s settle(데몬 연결·입력 포커스 준비) 후 안정화 확인.
  // 검증: 6s 미만이면 입력이 조용히 무시됨(placeholder 만 렌더, readKey 미준비).
  await sleep(bootSec * 1000);
  let prev = '';
  for (let i = 0; i < 8; i++) {
    const cur = await h.renderScreen();
    if (cur === prev && cur.length > 50) break;
    prev = cur;
    await sleep(1000);
  }
  console.log('===== BOOT SCREEN =====');
  console.log(await h.renderScreen());

  if (prompt) {
    console.error(`[drive-tui] sending prompt (${prompt.length} chars, paste=${pasteMode}): ${JSON.stringify(prompt.slice(0, 120))}${prompt.length > 120 ? '…' : ''}`);
    if (pasteMode) {
      // bracketed paste: CSI 200~ … CSI 201~ 로 감싸면 내부 \n 이 제출로 안 샌다(클립보드 붙여넣기 등가).
      h.write(`\x1b[200~${prompt}\x1b[201~`);
      await sleep(400);
    } else {
      h.write(prompt);
      await sleep(400);
    }
    h.write('\r'); // Enter — paste 본문은 위에서 삽입만, 이 \r 로만 제출.
    // 턴 진행 대기 — 화면 안정화(연속 동일) 또는 최대 waitSec.
    let stable = 0;
    let last = '';
    for (let i = 0; i < waitSec; i++) {
      await sleep(1000);
      const cur = await h.renderScreen();
      if (cur === last) { stable++; if (stable >= 4) break; } else { stable = 0; }
      last = cur;
    }
    console.log('\n===== AFTER PROMPT (screen) =====');
    console.log(await h.renderScreen());
    // 전체 트랜스크립트(스크롤아웃 회수) + 판독 요약(툴콜 수·완료 뱃지).
    const full = stripAnsi(h.snapshot());
    console.log('\n===== SUMMARY =====');
    console.log(summarize(full));
    if (transcriptPath) { writeFileSync(transcriptPath, full); console.error(`[drive-tui] full transcript → ${transcriptPath} (${full.length}B)`); }
  }

  if (pngPath) {
    const png = await h.renderScreenPng();
    if (png) { writeFileSync(pngPath, png); console.error(`[drive-tui] screen PNG → ${pngPath} (${png.length}B)`); }
    else console.error('[drive-tui] PNG 렌더 실패(에뮬레이터/sharp 미가용)');
  }

  if (logsMode) {
    console.log('\n===== ISOLATED LOGS (tool-loop · best-effort) =====');
    try {
      const { execFileSync } = await import('node:child_process');
      const logArgs = ['run', 'bin/elanous.mjs', 'logs', ...(testMode ? ['--test'] : []), '--category', 'tool-loop,llm.stream,llm.router', '-n', '80'];
      console.log(execFileSync('bun', logArgs, { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 }));
    } catch (e) {
      console.error('[drive-tui] logs dump 실패 — standalone TUI 는 logs.db 미기록(file-trail 사용). 격리 데몬(nexus run --test) 가동 시 조회 가능:', (e as Error).message);
    }
  }

  h.kill();
  console.error('[drive-tui] done.');
}

main().catch((e) => { console.error('[drive-tui] error:', e); process.exit(1); });
