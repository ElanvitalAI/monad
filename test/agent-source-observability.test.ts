// 제1원칙 관측 가드 — 에이전트 "소스 수집"(참조 열람·기억 회상)이 logs.db 에 닿는지.
//
// 사건(2026-07-19): tui-sim 드라이브에서 monad 이 로컬 `~/source/ref` 를 0건 읽고
// 전부 WebSearch 로 우회했는데, `monad logs` 로는 그걸 전혀 관측할 수 없었다
// (기억조회·참조열람 툴콜이 logs.db 에 안 남고 세션 트랜스크립트에만 존재).
// 이는 제1원칙(자기 관측성) 위반 — 자기 인지의 소스 수집이 관측 관문을 안 탐.
//
// 이 가드는 소스 수집 5개 경로에 `debug.log('agent.source', <kind>, …)` 계측이
// 존재함을 구조적으로 고정한다. 향후 "debug 로그 정리" PR 이 이를 제거하면
// 이 테스트가 실패하며 이유를 가리킨다. federation-guard-l1 패턴 이식.
//
// 관측 조회: `monad logs --category agent.source` → read/grep/web/recall 이
// 한 스토어에서 보인다. read/grep 은 external 플래그로 로컬 vs 외부 트리
// (예: ~/source/ref) 를 구분 → "canonical 로컬 소스 대신 웹 우회했나" 판별.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

interface SourceProbe {
  kind: string;
  file: string;
  why: string;
}

const PROBES: readonly SourceProbe[] = [
  {
    kind: 'read',
    file: 'src/boot/daemon-tools/read.ts',
    why: '참조 파일 열람 — external 플래그로 로컬(cwd 내) vs 외부 트리(~/source/ref 등) 구분',
  },
  {
    kind: 'grep',
    file: 'src/boot/daemon-tools/grep.ts',
    why: '로컬 검색 — 무엇을·어디서(external) 뒤졌나',
  },
  {
    kind: 'web',
    file: 'src/boot/daemon-tools/web-search.ts',
    why: '웹 우회 조회 — 로컬 소스 대비 web 우회를 kind=web 로 분리',
  },
  {
    kind: 'recall (self)',
    file: 'src/domains/self-awareness-tool.ts',
    why: 'self_recall — 자기 기억(에피소드+문서벡터) 회상',
  },
  {
    kind: 'recall (memory-file)',
    file: 'src/memory.ts',
    why: 'searchMemories — 큐레이션 파일메모리 회상',
  },
  {
    kind: 'interactive (TUI/messenger/REPL)',
    file: 'src/session-runtime/index.ts',
    why: 'dispatchSessionRuntimeTool choke-point — TUI/messenger/REPL 의 Read/Grep/Glob/WebSearch/RunShell(curl→web) 계측(데몬 경로와 별개·드라이브 관측 갭 수복)',
  },
];

describe('agent.source observability guard (제1원칙 소스 수집 관측)', () => {
  for (const probe of PROBES) {
    test(`${probe.file} emits debug.log('agent.source', …) — ${probe.kind}`, () => {
      const src = readFileSync(join(ROOT, probe.file), 'utf-8');
      // category 문자열 리터럴이 debug.log 첫 인자로 존재하는지(따옴표 무관).
      const hasCategory = /debug\.log\(\s*['"]agent\.source['"]/.test(src);
      expect(hasCategory).toBe(true);
    });
  }

  test('read/grep tag external(로컬 vs 외부 트리) so ref-bypass is observable', () => {
    for (const file of ['src/boot/daemon-tools/read.ts', 'src/boot/daemon-tools/grep.ts']) {
      const src = readFileSync(join(ROOT, file), 'utf-8');
      expect(src.includes('external')).toBe(true);
    }
  });
});
