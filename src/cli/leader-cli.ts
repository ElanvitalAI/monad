// ── `elanous leader` CLI (P1 · 2026-07-26) ──────────────────────────────────
//
// `status` — 권위(leader.json) ⊗ 관측 축(bun link · launchd plist · 31415 실프로세스 · self)
//            대조. READ-ONLY. `running` 축은 lsof 라 여기서만 조회(부팅 경로 무영향).
// `claim`  — 이 트리를 운영 리더로 승격: **bun link → leader.json** 순서(link 실패 시 권위를
//            기록하지 않아 부분 적용을 막는다).
//
// ⚠️ `claim` 은 outward-facing(머신 전역 운영 지정) → 기본 dry-run, `--yes` 로만 실행.
// ⚠️ **launchd plist 는 이 명령이 옮기지 않는다** — 운영 데몬 재기동을 유발하는 별개 행위이고,
//    미구현을 플래그로 약속하지 않기 위해 리더 트리에서 `elanous nexus install` 로 분리한다.
//    (status/claim 이 어긋남을 감지하면 그 명령을 안내한다.)

import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import {
  leaderFilePath,
  leaderRefusalFilePath,
  observeLeaderAxes,
  readLeader,
  readLeaderRefusal,
  writeLeader,
  normalizeTree,
  type LeaderRecord,
  type LeaderRefusalRecord,
  resolveRunningScript,
  treeFromScriptPath,
  installedCopyRoot,
} from '../instance/leader.js';

export interface LeaderCliDeps {
  out?: { log: (s: string) => void; error: (s: string) => void };
  now?: () => string;
  runBunLink?: (tree: string) => void;
  write?: (r: LeaderRecord) => void;
}

const liveDeps: Required<LeaderCliDeps> = {
  out: { log: (s) => console.log(s), error: (s) => console.error(s) },
  now: () => new Date().toISOString(),
  runBunLink: (tree) => { execFileSync('bun', ['link'], { cwd: tree, stdio: 'inherit' }); },
  write: writeLeader,
};

/** 순수 렌더 — 테스트가 문자열로 계약을 고정할 수 있게 분리. */
export function renderLeaderStatus(
  axes: ReturnType<typeof observeLeaderAxes>,
  rec: LeaderRecord | null,
  /** P4 완화 ② — 최근 거부 기록. 데몬이 안 뜨는 이유를 **여기서 즉시** 답할 수 있게 한다. */
  refusal: LeaderRefusalRecord | null = null,
): string {
  const installedAxes = axes.installed ?? {};
  const mark = (v: string | null, name?: string) => {
    if (!v && name && installedAxes[name]) return `설치본 (${installedAxes[name]})`;
    if (!v) return '(해석 불가)';
    if (!axes.authority) return v;
    return v === axes.authority ? `${v}  ✓` : `${v}  ⚠️ 드리프트`;
  };
  const L: string[] = [];
  L.push('━━ 운영 리더 ━━');
  L.push(`  권위 (leader.json) : ${axes.authority ?? '(미지정 — 3축 추론 대기)'}`);
  if (rec) {
    L.push(`    승격  : ${rec.promotedAt}${rec.promotedBy ? ` · ${rec.promotedBy}` : ''}${rec.bootstrapped ? ' · 자동추론' : ''}`);
    if (rec.reason) L.push(`    사유  : ${rec.reason}`);
    if (rec.previous) L.push(`    직전  : ${rec.previous.tree} (until ${rec.previous.until})`);
  }
  L.push('  ── 관측 축 ──');
  L.push(`  bun link           : ${mark(axes.bunLink, 'bun-link')}`);
  L.push(`  launchd plist      : ${mark(axes.launchd, 'launchd')}`);
  L.push(`  31415 실프로세스   : ${axes.running || installedAxes.running ? mark(axes.running, 'running') : '(미가동/미조회)'}`);
  L.push(`  이 프로세스 트리   : ${axes.self}${axes.authority ? (axes.self === axes.authority ? '  ✓ 리더' : '  · 비-리더') : ''}`);
  L.push('');
  // ⚠️ '정합' 과 '확인 불가' 를 섞지 않는다 — 축이 없어서 조용한 것과 일치해서 조용한 것은 다르다.
  if (!axes.coherent) {
    L.push(`  ⚠️ 드리프트(${axes.drift.join(', ')}) — 'elanous leader claim --yes' 로 권위+bun link 이동`);
    if (axes.drift.includes('launchd')) L.push("     launchd 는 별도: 리더 트리에서 'elanous nexus install' (데몬 재기동)");
  } else if (axes.unresolved.length > 0) {
    L.push(`  ⚠️ 해석 불가 축: ${axes.unresolved.join(', ')} — 나머지는 일치하나 **정합을 확인할 수 없습니다**.`);
  } else if (!axes.authority) {
    L.push('  · 권위 미지정 — 리더 트리에서 부팅하거나 `elanous leader claim --yes` 로 지정하세요.');
  } else {
    const installedNames = Object.keys(installedAxes);
    L.push(installedNames.length > 0
      ? `  ✅ 정합 — 트리 축은 권위와 같고, 설치본 축(${installedNames.join(', ')})은 운영 코드(설치본)를 가리킵니다.`
      : '  ✅ 정합 — 해석된 모든 축이 권위와 같은 트리를 가리킵니다.');
  }
  // ★ P4 완화 ② — 거부가 있었으면 **가장 눈에 띄는 자리**에 싣는다. launchd KeepAlive 가 재기동을
  //   반복하면 사람은 "데몬이 안 뜬다"만 보이고 이유를 모른다. 그 유일한 단서가 이 줄이다.
  if (refusal) {
    L.push('');
    L.push(`  ⛔ 최근 거부 (${refusal.refusedAt}) — ${refusal.why}`);
    L.push(`     거부된 트리: ${refusal.selfTree}${refusal.depth > 0 ? ` · 중첩 depth ${refusal.depth}` : ''}`);
    L.push(`     기록: ${leaderRefusalFilePath()}`);
  }
  return L.join('\n');
}

export function registerLeaderCommands(program: Command, deps: LeaderCliDeps = {}): void {
  const d = { ...liveDeps, ...deps };
  const cmd = program.command('leader').description('운영 리더(머신 전역 prod 지정) 조회·승격 — 동일 레포 다중 체크아웃에서 "어디가 운영인가"의 단일 권위');

  cmd.command('status', { isDefault: true })
    .description('권위(leader.json) ⊗ 관측 축(bun link·launchd·31415 실프로세스·self) 대조 (READ-ONLY)')
    .option('--json', 'JSON 출력')
    .action((o: { json?: boolean }) => {
      // running 축은 lsof 서브프로세스라 **status 에서만** 조회한다(부팅 경로 무영향).
      const runningScript = resolveRunningScript();
      const axes = observeLeaderAxes({
        running: runningScript ? treeFromScriptPath(runningScript) : null,
        installed: { running: runningScript ? installedCopyRoot(runningScript) : null },
      });
      const rec = readLeader();
      const refusal = readLeaderRefusal();
      if (o.json) {
        d.out.log(JSON.stringify({
          ...axes, record: rec, recentRefusal: refusal,
          path: leaderFilePath(), refusalPath: leaderRefusalFilePath(),
        }, null, 2));
        return;
      }
      d.out.log(renderLeaderStatus(axes, rec, refusal));
    });

  cmd.command('claim')
    .description('이 트리를 운영 리더로 승격 — bun link + leader.json (launchd plist 는 별도: nexus install). 기본 dry-run.')
    .option('--yes', '실제 적용 (기본 dry-run)')
    .option('--reason <text>', '승격 사유(기록에 남는다)')
    .action((o: { yes?: boolean; reason?: string }) => {
      const axes = observeLeaderAxes();
      const target = axes.self;
      const prev = readLeader();
      // ⚠️ 조기 종료는 **권위가 이 트리이고 드리프트도 미해석 축도 없을 때만** — 누락 축을
      //    복구하지 않고 빠져나가면 'claim 했는데 여전히 어긋남' 이 된다.
      if (prev && normalizeTree(prev.tree) === target && axes.coherent && axes.unresolved.length === 0) {
        d.out.log(`이미 운영 리더이고 해석된 모든 축이 정합합니다: ${target}`);
        return;
      }
      // 이 명령이 **실제로** 옮기는 것만 계획에 적는다(미구현을 약속하지 않는다).
      const plan: string[] = [
        `  1) bun link    → ${target}  (먼저 — 실패하면 권위를 기록하지 않는다)`,
        `  2) leader.json → ${target}`,
        `  ·  launchd plist는 이 명령이 옮기지 않습니다 → 리더 트리에서 'elanous nexus install' (데몬 재기동)`,
      ];
      if (!o.yes) {
        d.out.log(`[dry-run] 운영 리더 승격 계획:\n${plan.join('\n')}\n\n적용하려면 --yes 를 붙이세요.`);
        if (axes.launchd && axes.launchd !== target) {
          d.out.error(`⚠️ launchd 는 여전히 ${axes.launchd} — 데몬은 옛 트리 코드로 뜹니다. 리더 트리에서 'elanous nexus install' 을 실행하세요.`);
        }
        return;
      }
      const rec: LeaderRecord = {
        tree: target,
        promotedAt: d.now(),
        promotedBy: process.env.USER ?? 'unknown',
        ...(o.reason ? { reason: o.reason } : {}),
        ...(prev ? { previous: { tree: normalizeTree(prev.tree), until: d.now() } } : {}),
      };
      // ★ 순서 — bun link 를 **먼저**. 실패하면 권위를 기록하지 않아 '권위만 옮겨간 부분 적용'
      //   상태를 만들지 않는다(리뷰 should-fix).
      try { d.runBunLink(target); d.out.log(`✓ bun link → ${target}`); }
      catch (e) {
        d.out.error(`✗ bun link 실패 — 권위를 기록하지 않고 중단합니다(부분 적용 방지): ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      d.write(rec);
      d.out.log(`✓ leader.json → ${target}`);
      if (axes.launchd && axes.launchd !== target) {
        d.out.error(`⚠️ launchd 는 여전히 ${axes.launchd} — 데몬은 옛 트리 코드로 뜹니다. 이 트리에서 'elanous nexus install' 을 실행하세요.`);
      }
    });
}
