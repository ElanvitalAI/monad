// ── 미션 tool surface — 프레임워크 점진노출 준수 장치 (2026-07-17) ──────────────
//
// 미션 registry(getAutopilotToolRegistry)는 tool 을 하드코딩 큐레이션한다 —
// 재현성(빌드마다 동일 tool) 때문에 정당하지만, native-tool-catalog(surface/
// intent 점진노출의 SoT) 밖으로 나가면 "프레임워크 밖 노출" drift 가 쌓인다.
//
// 이 장치는 tsc touch-clean 게이트와 동형: 기존부채(grandfather)는 관용하되
// 신규 프레임워크-밖 노출은 CI 로 차단한다. 새 tool 을 미션에 하드코딩하면
// catalog 에 등록(= 프레임워크 참여)하거나, 정당하면 근거와 함께 grandfather
// 에 추가해야 통과한다. 궁극 해소 = P2(coding/mission surface 수렴)에서
// grandfather 를 비운다.

import { describe, it, expect } from 'bun:test';
import { getAutopilotToolRegistry } from './tool-registry.js';
import { nativeToolCatalog } from '../native-tool-catalog.js';
import { CORE_TOOL_SPECS } from '../domains/core-tools.js';

/** 프레임워크(catalog) 밖에서 하드코딩 노출된 미션 tool 의 grandfather.
 *  P2 수렴에서 catalog 편입하며 비워야 한다. 새 tool 은 여기 추가하지 말고
 *  native-tool-catalog 에 surface/intent 메타와 함께 등록하라. */
const KNOWN_FRAMEWORK_GAPS: readonly string[] = [
  // terminal-agency 웹터미널 tool 3종 — spec 만 있고 catalog entry 없음.
  'WebTerminalSnapshot',
  'WebTerminalInput',
  'WebTerminalScreenshot',
];

// 프레임워크 SoT = L1 native(native-tool-catalog) ∪ L2 core(core-tools의
// CORE_TOOL_SPECS·self-ops 층). 미션이 둘 중 하나에서 끌어온 tool 은 "프레임워크
// 참여"로 간주(ad-hoc 하드코딩 아님). L2 core 툴(self_recall·logs_query·
// ops_status·memory_recall 등)은 native 가 아니라 별도 SoT 라 여기서 함께 인정.
function catalogKnownNames(): Set<string> {
  const s = new Set<string>();
  for (const e of nativeToolCatalog) {
    s.add(e.id);
    s.add(e.displayName);
    for (const a of e.aliases ?? []) s.add(a);
  }
  for (const spec of CORE_TOOL_SPECS) s.add(spec.name);
  return s;
}

describe('미션 tool surface — 프레임워크 점진노출 준수 (drift 장치)', () => {
  it('미션이 광고하는 모든 tool 은 catalog 등록 OR 명시 grandfather', () => {
    const known = catalogKnownNames();
    const missionTools = getAutopilotToolRegistry().tools.map(t => t.name);
    const offenders = missionTools.filter(
      n => !known.has(n) && !KNOWN_FRAMEWORK_GAPS.includes(n),
    );
    // offenders 비어있지 않으면 = 프레임워크 밖 하드코딩 신규 노출.
    // → native-tool-catalog 에 등록(권장)하거나 grandfather 에 근거와 함께 추가.
    expect(offenders).toEqual([]);
  });

  it('grandfather 는 stale 금지 — 전부 실제 미션 tool 이며 아직 catalog 미등록', () => {
    const known = catalogKnownNames();
    const missionTools = new Set(getAutopilotToolRegistry().tools.map(t => t.name));
    for (const gap of KNOWN_FRAMEWORK_GAPS) {
      // 미션이 실제로 노출 중이어야 함(사라진 tool 은 grandfather 에서 제거).
      expect(missionTools.has(gap)).toBe(true);
      // catalog 에 편입되면 grandfather 에서 빼라(관용은 미등록에만).
      expect(known.has(gap)).toBe(false);
    }
  });
});
