// NEXUS · GET /v1/design-check — the craft-rulebook verdict, over the wire
//
// `monad repo design-check` already answers "which craft rulebooks does this
// repository's DESIGN.md declare, and which of them cannot be found?" — but
// only into a terminal. This route carries the SAME verdict (resolved by
// `resolveDesignCheck`, not re-derived here) to the PWA, so the browser panel
// and the CLI can never drift apart.
//
// ⭐ Two roots, deliberately different — this is the whole subtlety:
//
//   DESIGN.md       ← the ACTIVE REPOSITORY, found the way `/v1/worktrees`
//                     finds it (`git rev-parse --show-toplevel` from the
//                     daemon's cwd). The daemon watches one checkout; that
//                     checkout's design document is the subject.
//   craft/          ← MONAD'S INSTALLATION directory. `#11793` established
//                     that the rulebooks travel with monad, not with the
//                     project under inspection, so a project outside the
//                     monad tree still resolves them.
//
// Reading either root from the other would reintroduce exactly the
// `process.cwd()` coupling `#11793` removed.
//
// Wire shape:
//   { repoRoot: string | null,
//     ok: true,  documentPath, craftDirectory,
//                availableRulebooks[], declaredRulebooks[], unavailableRulebooks[],
//                exitCode: 0 | 1 }
//   { repoRoot: string | null,
//     ok: false, blockedOn: 'no-repository' | 'craft-directory' | 'design-document',
//                path: string | null, exitCode: 1 }
//
// ⛔ `blockedOn` is carried through rather than flattened to an error string:
//    a renderer must be able to tell "nothing is missing" from "I could not
//    read the directory", and prose cannot be switched on reliably.
//
// Read-only · no auth (mirrors `/v1/worktrees` under the same same-origin
// enforcement layer).

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { designCheckExitCode, resolveDesignCheck, type DesignCheckDeps } from '../../design/design-check.js';
import { directionFromDesignMd, listDesignDirections, parseDeclaredDirection } from '../../design/design-directions.js';
import { jsonResponse } from './http-server.js';
import { detectRepoRoot } from './worktrees.js';

export interface DesignCheckRouteDeps extends DesignCheckDeps {
  /** Active repository root, or null outside a checkout. Injected so the
   *  route can be tested without spawning git. */
  repoRoot: () => string | null;
  /** Absolute path of monad's vendored craft rulebook directory. */
  craftDirectory: () => string;
}

/** Craft rulebooks ship with monad. Resolved from THIS file's location so a
 *  daemon serving a project outside the monad tree still finds them —
 *  `src/nexus/api/` → repo root → `docs/design/craft`. */
function installedCraftDirectory(): string {
  return resolve(import.meta.dir, '..', '..', '..', 'docs', 'design', 'craft');
}

const liveDeps: DesignCheckRouteDeps = {
  readFile: (path, encoding) => readFileSync(path, encoding),
  readdir: (path) => readdirSync(path),
  repoRoot: () => detectRepoRoot(),
  craftDirectory: installedCraftDirectory,
};

/** Pure — builds the wire body from injected reads. Exported for tests so the
 *  route's shape is pinned without booting an HTTP server. */
export function buildDesignCheckView(overrides: Partial<DesignCheckRouteDeps> = {}): Record<string, unknown> {
  const deps = { ...liveDeps, ...overrides };
  const repoRoot = deps.repoRoot();
  if (!repoRoot) {
    // ⛔ Distinct from a read failure. "The daemon is not inside a checkout"
    // is a deployment fact the operator can act on; collapsing it into
    // `design-document` would send them hunting for a missing file instead.
    return { repoRoot: null, ok: false, blockedOn: 'no-repository', path: null, exitCode: 1 };
  }
  const outcome = resolveDesignCheck(
    join(repoRoot, 'DESIGN.md'),
    deps.craftDirectory(),
    { readFile: deps.readFile, readdir: deps.readdir },
  );
  const exitCode = designCheckExitCode(outcome);
  if (!outcome.ok) {
    return { repoRoot, ok: false, blockedOn: outcome.blockedOn, path: outcome.path, exitCode };
  }
  // B5 — 방향은 «같은 문서»에서 나온다. 두 번째 라우트를 만들면 두 번째
  // 「어느 저장소의 DESIGN.md 인가」 답이 생긴다. 여기서 같이 실어 보낸다.
  //
  // ⛔ 방향을 못 읽는 것은 «전체를 실패로 만들지 않는다» — 규칙집 판정은
  //    독립적으로 유효하고, 방향은 선택이다. 그래서 exitCode 에 안 섞는다.
  let document = '';
  try {
    document = deps.readFile(outcome.documentPath, 'utf8');
  } catch { /* 방금 읽힌 문서다. 사라졌으면 「선언 없음」과 같은 화면이 맞다. */ }
  // ⭐ 방향은 «둘»에서 온다: 테마 레지스트리(여섯) ⊕ ***이 문서 자신***.
  //    🩸 2026-09-08 실측: 여섯은 전부 «터미널 색 스킴»이라 웹 레퍼런스에서 뽑은 팔레트·서체는
  //       ***어느 이름으로도 선언할 수 없었다*** — 선언하면 늘 `unavailable` 로 떨어졌다.
  //    ⛔ 문서 방향을 «항상» 만들지 않는다. 선언이 테마에 없을 때만 «그 이름으로» 시도한다 —
  //       그래야 오타가 조용히 「스스로 선언한 방향」으로 둔갑하지 않는다(팔레트를 못 읽으면 null).
  const themeDirections = listDesignDirections();
  const declaredAmongThemes = parseDeclaredDirection(document, themeDirections);
  const documentDirection = declaredAmongThemes.unavailable === null
    ? null
    : directionFromDesignMd(document, declaredAmongThemes.unavailable);
  const availableDirections = documentDirection === null
    ? themeDirections
    : [...themeDirections, documentDirection];
  const direction = parseDeclaredDirection(document, availableDirections);

  return {
    repoRoot,
    ok: true,
    documentPath: outcome.documentPath,
    craftDirectory: outcome.craftDirectory,
    availableRulebooks: outcome.availableRulebooks,
    declaredRulebooks: outcome.declaredRulebooks,
    unavailableRulebooks: outcome.unavailableRulebooks,
    exitCode,
    directions: {
      declared: direction.declared,
      unavailable: direction.unavailable,
      available: availableDirections.map((d) => ({
        id: d.id, mood: d.mood, isDark: d.isDark, isPastel: d.isPastel, swatch: d.swatch,
        // ⛔ 「테마에서 왔다」와 「이 문서가 스스로 정했다」를 화면이 가를 수 있어야 한다.
        source: d.source ?? 'theme', typography: d.typography ?? null,
      })),
    },
  };
}

/** GET /v1/design-check — see top-of-file wire shape. Always 200: a blocked
 *  verdict is a RESULT the panel renders, not a transport failure. Sending
 *  4xx/5xx here would make "your DESIGN.md lists a missing rulebook" look
 *  like the daemon is broken. */
export function handleDesignCheck(): Response {
  return jsonResponse(buildDesignCheckView(), 200);
}
