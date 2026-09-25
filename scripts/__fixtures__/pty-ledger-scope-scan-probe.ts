// ⭐ `scanPtyLedgerScope` 를 «다른 프로세스»에서 한 번 돌리고 결과를 한 줄 JSON 으로 낸다.
//
// ⛔ 왜 파일을 따로 두는가: 권한 오류(EACCES)는 root 로 돌면 재현되지 않는다 — 그래서 그 회귀는
//   ***비특권 자식***에서 돌려야 하고(`scripts/lib/unprivileged-child.ts`), 그 자식이 실행할 진입점이
//   필요하다. 프로덕션 코드에 「테스트용 스위치」를 넣지 않기 위해 fixture 로 뺀다
//   (`scripts/__fixtures__/corpus-fake-worker.ts` 와 같은 자리·같은 이유).
//
// 사용: bun scripts/__fixtures__/pty-ledger-scope-scan-probe.ts '<targets JSON>'
//   ⛔ 입력을 env 가 아니라 «argv» 로 받는다 — sudo/su 가 환경변수를 리셋하므로 env 는 자식에 안 닿는다.
import { measureRunLedgerGaps } from '../../src/self-implement/run-ledger.js';
import { scanPtyLedgerScope } from '../observability/pty-ledger-scope.js';
import type { PtyManifestTarget } from '../../src/domains/fleet.js';

/** ⛔ stdout 에 다른 것이 섞여도(로그 미러 등) 부모가 «이 줄»만 골라 읽게 하는 표식. */
export const PTY_LEDGER_SCOPE_PROBE_MARKER = 'PTY_LEDGER_SCOPE_PROBE ';

if (import.meta.main) {
  const raw = process.argv[2] ?? '[]';
  let targets: PtyManifestTarget[];
  try {
    targets = JSON.parse(raw) as PtyManifestTarget[];
  } catch (error) {
    process.stderr.write(`probe: targets argv is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  const scan = scanPtyLedgerScope(targets);
  const measurement = measureRunLedgerGaps(scan.roots);
  process.stdout.write(`${PTY_LEDGER_SCOPE_PROBE_MARKER}${JSON.stringify({
    // ⭐ 「누가 쟀나」를 산출에 실어 보낸다 — 부모는 이 값이 0 이 «아님»을 확인하고서야 결과를 믿는다.
    uid: process.getuid?.() ?? -1,
    roots: scan.roots.map((root) => ({ ...root, ledgerRunIds: root.ledgerRunIds ? [...root.ledgerRunIds] : undefined })),
    legacy: scan.legacy,
    ledgerEvidence: scan.ledgerEvidence,
    measurement,
  })}\n`);
}
