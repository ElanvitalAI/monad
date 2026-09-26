// ── `elanous where` (P3 · 2026-07-26) ────────────────────────────────────────
//
// "지금 어느 우주인가 — **그리고 왜**". 이 트랙의 핵심 요구는 "격리가 편해지는 것"만이 아니라
// **헷갈리지 않는 것**이었다. 그래서 결과(prod/test)뿐 아니라 **어느 층에서 결정됐는지**를 같이
// 보여준다. 반대 실수("테스트인 줄 알았는데 prod")도 이 화면 하나로 잡힌다.
//
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §5c.

import type { Command } from 'commander';
import { observeLeaderAxes, isLeaderTree } from '../instance/leader.js';
import { resolveCurrentInstance } from '../instance/current.js';
import { treeDerivedTestEnabled, effectiveInstanceRoot, normRoot, type InstanceResolution } from '../instance/resolve.js';

import { getElanousConfigDir } from '../elanous-config-dir.js';

const LAYER_LABEL: Record<InstanceResolution['layer'], string> = {
  'explicit-flag': '1층 · 명시 플래그',
  'parent-stamp': '2층 · 부모 스탬프(env)',
  'tree-derived': '3층 · 트리 파생',
  default: '4층 · 기본값',
};

/** 순수 렌더 — 테스트가 문자열로 계약을 고정할 수 있게 분리. */
export function renderWhere(r: InstanceResolution, extra: {
  selfTree: string; authority: string | null; isLeader: boolean | null;
  configDir: string; treeDerivedEnabled: boolean;
}): string {
  const L: string[] = [];
  L.push('━━ 지금 어느 우주인가 ━━');
  L.push(`  인스턴스   : ${r.kind === 'prod' ? '🔴 prod (운영)' : '🟢 test (격리)'}`);
  L.push(`  뿌리       : ${r.root}`);
  L.push(`  config-dir : ${extra.configDir}${normRoot(extra.configDir) === normRoot(r.root) ? '  ✓ 같은 뿌리' : '  ⚠️ 뿌리와 다름(축 어긋남)'}`);
  L.push('');
  L.push(`  왜         : ${LAYER_LABEL[r.layer]} — ${r.why}`);
  L.push('');
  L.push('  ── 판정 입력 ──');
  L.push(`  이 트리    : ${extra.selfTree}`);
  L.push(`  리더 권위  : ${extra.authority ?? '(미지정)'}${extra.isLeader === null ? ' · 판정 보류' : extra.isLeader ? ' · 이 트리가 리더' : ' · 비-리더'}`);
  L.push(`  트리 파생  : ${extra.treeDerivedEnabled ? 'ON' : 'OFF (기본)'}`);
  if (r.wouldBeIfTreeDerived) {
    L.push('');
    L.push(`  ⓘ 트리 파생을 켜면 → ${r.wouldBeIfTreeDerived.kind} · ${r.wouldBeIfTreeDerived.root}`);
    L.push(`     (${r.wouldBeIfTreeDerived.why}) · config \`instance.treeDerivedTest\` 로 켭니다`);
  }
  return L.join('\n');
}

export interface WhereDeps {
  out?: { log: (s: string) => void };
  cwd?: () => string;
  treeDerivedEnabled?: () => boolean;
  configDir?: () => string;
}

export function registerWhereCommand(program: Command, deps: WhereDeps = {}): void {
  const out = deps.out ?? { log: (s: string) => console.log(s) };
  program.command('where')
    .description('지금 이 프로세스가 어느 인스턴스(prod/test)에 속하는지 **와 그 이유**를 보여준다 (READ-ONLY)')
    .option('--json', 'JSON 출력')
    .action((o: { json?: boolean }) => {
      const cwd = (deps.cwd ?? (() => process.cwd()))();
      const axes = observeLeaderAxes();
      // ⚠️ 스위치는 **raw prod config.json** 에서 직접 읽는다 — `getUserConfig()` 를 쓰면
      //    config 경로 해석이 리졸버를 되불러 재귀한다(P3 self review). 여기서는 미리보기
      //    전용이라 raw 읽기로 충분하고, 3층 실배선(P3b)에서 스위치 소스를 확정한다.
      // ★ 리졸버와 **같은 스위치**를 쓴다 — 진단이 실제 해석과 갈리면 거짓 보고가 된다
      //   (스위치 ON 인데 where 만 test 라고 말하는 상황 · self review 지적).
      const treeDerivedEnabled = (deps.treeDerivedEnabled ?? treeDerivedTestEnabled)();
      const configDir = (deps.configDir ?? getElanousConfigDir)();
      const r = resolveCurrentInstance({
        cwd: () => cwd,
        treeDerivedEnabled: () => treeDerivedEnabled,
      });
      // 진단 정합 가드 — 화면이 말하는 뿌리와 **실제 스토어가 쓰는 뿌리**가 같아야 한다.
      const actualRoot = effectiveInstanceRoot();
      const mismatch = normRoot(actualRoot) !== normRoot(r.root) ? actualRoot : null;
      if (o.json) {
        // ⚠️ 경고를 JSON 앞에 찍으면 파싱이 깨진다 — **필드로** 싣는다.
        out.log(JSON.stringify({ ...r, selfTree: axes.self, authority: axes.authority, isLeader: isLeaderTree(axes), configDir, treeDerivedEnabled, actualRoot, mismatch }, null, 2));
        return;
      }
      if (mismatch) out.log(`  ⚠️ 진단 불일치 — 해석=${r.root} 이나 실제 스토어 뿌리=${mismatch} (버그로 보고해 주세요)`);
      out.log(renderWhere(r, { selfTree: axes.self, authority: axes.authority, isLeader: isLeaderTree(axes), configDir, treeDerivedEnabled }));
    });
}
