// ⭐ 코퍼스 러너 검증용 **가짜 worker**.
//
// ⛔ 왜 파일을 따로 두는가: 종전엔 프로덕션 러너 안에 `CORPUS_TEST_WORKER_MODE` 스위치가 있어
// **환경변수 하나로 모든 grounding 이 `files: []` 를 냈다** — 자에 그런 스위치가 있으면 그 자의
// 어떤 수치도 신뢰할 수 없다(리뷰 must-fix). ⇒ 타임아웃·스트리밍·락 검증은 **이 파일을 스폰**해서
// 하고, 프로덕션 경로는 테스트를 모른다.
//
// 동작은 env 로 고른다 (이 파일 안에서만 유효):
//   FAKE_WORKER_MODE=hang            영원히 매달린다 (타임아웃·취소 검증)
//   FAKE_WORKER_MODE=hang-item:<id>  그 문항만 매달린다 (두 역할 모두)
//   FAKE_WORKER_MODE=hang-authoring-item:<id>
//                                    그 문항의 **authoring 역할만** 매달린다 —
//                                    같은 문항에서 "타임아웃" ↔ "완주했지만 0건" 을 대조하려면 필요하다
//   FAKE_WORKER_MODE=stream-hold     B1 만 즉시 답하고 나머지는 매달린다 (첫 줄 스트리밍 후 락 유지)
//   FAKE_WORKER_MODE=hang-grandchild  매달린 손자를 띄운다 (프로세스 그룹 정리 검증)
//   FAKE_WORKER_DELAYS_BY_ITEM        JSON 문항별 지연(ms)으로 완료 순서 역전을 재현한다
//   FAKE_WORKER_DELAYS_BY_TRIAL       JSON `문항:반복`별 지연(ms)으로 반복 스트리밍 순서를 검증한다
//   기본                              즉시 빈 결과를 낸다
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { installCorpusWorkerLiveness } from '../corpus-worker-lifecycle.js';

installCorpusWorkerLiveness();
if (process.env.FAKE_WORKER_PID_PATH) writeFileSync(process.env.FAKE_WORKER_PID_PATH, String(process.pid));
const mode = process.env.FAKE_WORKER_MODE ?? '';
const item = process.env.CORPUS_WORKER_ITEM ?? '';
const kind = process.env.CORPUS_WORKER_KIND ?? '';
const lifecyclePath = process.env.FAKE_WORKER_LIFECYCLE_PATH;
const delayMs = Number(process.env.FAKE_WORKER_DELAY_MS ?? 0);
const delaysByItem = JSON.parse(process.env.FAKE_WORKER_DELAYS_BY_ITEM ?? '{}') as Record<string, number>;
const delaysByTrial = JSON.parse(process.env.FAKE_WORKER_DELAYS_BY_TRIAL ?? '{}') as Record<string, number>;
const attempt = process.env.CORPUS_WORKER_ATTEMPT ?? '0';
if (lifecyclePath) appendFileSync(lifecyclePath, 'start\n');
await Bun.sleep(delaysByTrial[`${item}:${attempt}`] ?? delaysByItem[item] ?? delayMs);

if (mode === 'hang-grandchild') {
  // ⭐ 마커를 **argv 에** 심는다(env 는 `ps` 출력에 안 나온다) — PID 를 모르는 잔존 손자를
  //    프로세스 표에서 세기 위한 것이다. 리뷰 must-fix(#6056)가 지적한 *"살아 있는
  //    비-group-leader 손자"* 가 정확히 이 프로세스다.
  const marker = process.env.CORPUS_WORKER_MARKER ?? '';
  const grandchild = spawn(process.execPath, ['-e', `/* ${marker} */ setInterval(() => {}, 1000)`], { detached: false, stdio: 'ignore' });
  if (process.env.FAKE_GRANDCHILD_PID_PATH) writeFileSync(process.env.FAKE_GRANDCHILD_PID_PATH, String(grandchild.pid));
  process.stdout.write(JSON.stringify({ files: [], grandchildPid: grandchild.pid }));
  await new Promise(() => {});
}
if (mode === 'hang') await new Promise(() => {});
if (mode.startsWith('hang-item:') && item === mode.slice('hang-item:'.length)) await new Promise(() => {});
if (mode.startsWith('hang-authoring-item:') && kind === 'authoring'
  && item === mode.slice('hang-authoring-item:'.length)) await new Promise(() => {});
// 첫 줄이 나온 뒤 러너가 락을 계속 쥐고 있게 만든다(락 선점 검증용).
if (mode === 'stream-hold' && item !== 'B1') await new Promise(() => {});

process.stdout.write(JSON.stringify({
  files: [] as string[],
  ...(kind === 'authoring' || kind === 'authoring-free' ? { path: 'groundMissionInCodebase' } : {}),
}));
if (lifecyclePath) appendFileSync(lifecyclePath, 'end\n');

export {};   // 모듈로 만들어 top-level await 를 허용한다(tsc).
