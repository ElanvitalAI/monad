// ── 🗺️ 「이 문서를 «무는» 시험이 있나」 ────────────────────────────────────────
//
// ⛔⭐ 왜 «스캔»인가 — ***「유도」가 원리상 불가능하기 때문이다.***
//   게이트의 유도는 하위 경로를 보존한다(`src/a/b.ts → src/a/b.test.ts`). 문서에 대면:
//       AGENTS.md  →  AGENTS.test.ts     ⛔ 그런 파일은 «없다»
//       실제 지킴이 →  test/rules-contract.test.ts
//   ⇒ ***이름이 안 닮는다.*** 어떤 이름 규칙으로도 이 짝을 못 만든다.
//   📄 근거 = 내부 문서 `FINDING-the-document-guardian-map-must-be-scanned-not-derived-2026-08-25`
//
// ✅ 그래서 «역방향»으로 간다 — 시험을 훑어 「그 시험이 «읽는» 문서 경로」를 줍는다.
//   📏 2026-08-25 전수: 문서 5,438 중 「읽는 시험」이 있는 것 ***23 (0.42%)***.
//
// 🤝 정책(🅣 2026-08-25 · 채널 #12577) — ***「보고한다. 막지 않는다.」***
//   ⛔ 이 값으로 게이트를 «막지» 않는다. 분모가 0.42% 라 관문으로 만들면 잡음이 이긴다.
//
// ⛔⭐⭐ 재구현 금지 — 이것은 `importer-test-index.ts` 와 «같은 모양»이고 축만 다르다
//   (`import` ↔ `readFile`). 두 곳이 갈리면 그 순간 「같은 질문에 자가 둘」이 된다.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path/posix';

export interface DocumentGuardianIndex {
  /** 문서 경로 → 그 문서를 «읽는» 시험 경로들. */
  readonly guardiansByDocument: ReadonlyMap<string, readonly string[]>;
  /** ⛔ 열지 «못한» 시험 수 — 「지킴이 없음」과 «다른 값»이다.
   *
   *  ⭐ 0 이 아니면 `guardiansByDocument` 의 빈칸을 「지킴이가 없다」로 읽으면 «안 된다».
   *  그만큼 «안 봤다»는 뜻이다(이 저장소가 반복해 데인 「못 잰 0」의 처방). */
  readonly unreadableTests: number;
}

/** 시험이 그 «문서 경로»를 문자열로 들고 있나.
 *
 *  ⛔⭐ **basename 으로 매칭하지 않는다** — `'README.md'` 한 문자열이 저장소의 «모든»
 *  README 에 걸린다. 📏 실측(2026-08-25): 그 자로는 문서 **75개**가 «같은 13개» 시험에
 *  걸렸다. 전체 경로만 센다. */
function mentionsDocumentPath(testSource: string, documentPath: string): boolean {
  return testSource.includes(`'${documentPath}'`)
    || testSource.includes(`"${documentPath}"`)
    || testSource.includes(`\`${documentPath}\``);
}

/** 「그 문서를 «읽는»」 시험만 센다 — 단순 언급은 지킴이가 아니다.
 *
 *  📏 자를 세 번 갈아서 나온 조건이다(2026-08-25):
 *    ① 「언급」으로 셌다        → `README.md ← 82`  (문자열 우연)
 *    ② basename 으로 셌다      → 문서 75개가 같은 13개에 걸렸다
 *    ③ ✅ 전체 경로 ⊕ `readFile` → 23 (0.42%) */
function readsFiles(testSource: string): boolean {
  return /readFileSync|readFile\s*\(/.test(testSource);
}

/** 변경된 문서들에 대해 «그것을 읽는» 시험을 찾는다.
 *
 *  ⭐ 바늘(`documentPaths`)이 «변경분»뿐이라 시험 한 번 훑기로 끝난다 — 전체 지도를
 *  만들지 않는다. 게이트가 묻는 것도 「이번에 바뀐 문서」에 한정된다. */
export function buildDocumentGuardianIndex(
  cwd: string,
  testPaths: readonly string[],
  documentPaths: readonly string[],
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): DocumentGuardianIndex {
  const guardiansByDocument = new Map<string, string[]>();
  let unreadableTests = 0;
  if (documentPaths.length === 0) return { guardiansByDocument, unreadableTests };

  for (const testPath of testPaths) {
    let source: string;
    try {
      source = readFile(resolve(cwd, testPath));
    } catch {
      // ⛔ 「못 읽었다」를 «값으로» 센다 — 조용히 건너뛰면 「지킴이 없음」과 구별이 안 된다.
      unreadableTests += 1;
      continue;
    }
    if (!readsFiles(source)) continue;
    for (const documentPath of documentPaths) {
      if (!mentionsDocumentPath(source, documentPath)) continue;
      const guardians = guardiansByDocument.get(documentPath) ?? [];
      if (!guardians.includes(testPath)) guardians.push(testPath);
      guardiansByDocument.set(documentPath, guardians);
    }
  }

  return { guardiansByDocument, unreadableTests };
}

/** 산출 한 줄 — ⛔ 「막는 문면」이 아니라 «보고 문면»이다(🅣 정책). */
export function formatDocumentGuardians(index: DocumentGuardianIndex, documentPaths: readonly string[]): string {
  if (documentPaths.length === 0) return 'document guardians: (no documents changed)';
  const withGuardians = documentPaths.filter((d) => (index.guardiansByDocument.get(d)?.length ?? 0) > 0);
  const without = documentPaths.filter((d) => !withGuardians.includes(d));
  const shown = withGuardians
    .map((d) => `${d} ← ${(index.guardiansByDocument.get(d) ?? []).join(', ')}`)
    .join('; ');
  // ⛔ 「못 읽은 시험」이 있으면 «같이» 낸다 — 빈칸을 「지킴이 없음」으로 읽지 못하게.
  const unreadable = index.unreadableTests > 0 ? `; unreadable tests: ${index.unreadableTests}` : '';
  return `document guardians: ${withGuardians.length}/${documentPaths.length}`
    + (shown ? ` (${shown})` : '')
    + (without.length ? `; without: ${without.join(', ')}` : '')
    + unreadable;
}
