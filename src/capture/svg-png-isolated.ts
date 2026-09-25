// ── SVG→PNG 서브프로세스 격리 (Pango crash-safety · 2026-07-26) ────────────────────────────
//
// ⚠️ **근본 문제**: sharp(librsvg→Pango) 는 이모지 등 폰트가 없을 때 g_error 로 **프로세스를 하드 abort**
//   (SIGABRT) 한다 — glib 의 abort() 는 JS try/catch 로 **못 잡는 네이티브 종료**다. 그래서 인-프로세스
//   래스터화(`svgToPngBuffer`)는 keyframe 캡처(#5386)가 **self-dev/데몬 전체를 죽일 수 있다**(실측: 이모지
//   화면 + 상태전이 → self implement run 통째 크래시).
//
// **해법(대표 지시·서브프로세스 격리)**: sharp 래스터화를 **자식 프로세스**에서 돌린다 — Pango abort 가 나도
//   자식만 죽고, 부모는 자식의 비정상 종료(SIGABRT·비-0 exit·timeout)를 감지해 **null 을 반환**(fail-soft).
//   부모는 **어떤 경우에도** 죽지 않는다(never-throw). 네이티브 abort 는 in-process 로 못 막으므로 격리가 유일 방법.
//
// 부모: renderSvgToPngIsolated(svg) → `bun <this-file>` spawn · SVG=stdin · PNG=stdout · timeout 바운드.
// 자식: import.meta.main 가드 → stdin 의 SVG 를 읽어 in-process svgToPngBuffer(sharp)로 변환 → stdout(flush 후 exit).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 이 파일 경로(자식 엔트리로 재실행) — bun 이 .ts 를 직접 실행. */
const WORKER_PATH = fileURLToPath(import.meta.url);

/** 자식 래스터화 hard 타임아웃 — sharp/Pango 가 행에 걸려도 부모가 무기한 대기 안 하게(초과=kill+null). */
const DEFAULT_TIMEOUT_MS = 8000;

/** stdout 누적 상한(리뷰 should-fix) — 자식이 비정상적으로 많이 뱉어도 부모 메모리 폭증 방지. 터미널 스냅샷
 *  PNG 는 수 MB 미만이라 64MB 는 넉넉한 안전판. 초과 시 kill + null. */
const MAX_PNG_BYTES = 64 * 1024 * 1024;

/**
 * ★ SVG → PNG 를 **자식 프로세스**에서 안전하게 래스터화. 성공=PNG Buffer · 실패(자식 abort/비정상/timeout/
 *  spawn 오류/EPIPE/과대출력)=**null**(never-throw·fail-soft). 부모 프로세스는 **어떤 경우에도** 죽지 않는다.
 *  spawn 은 테스트 주입 가능(기본 node:child_process spawn).
 */
export async function renderSvgToPngIsolated(
  svg: string,
  opts: { timeoutMs?: number; spawnFn?: typeof spawn } = {},
): Promise<Buffer | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnFn = opts.spawnFn ?? spawn;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (v: Buffer | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    let child: ReturnType<typeof spawn>;
    try {
      // stdout=pipe(PNG 수집)·stdin=pipe(SVG 주입)·stderr=ignore(Pango 경고 소음 차단).
      child = spawnFn(process.execPath, [WORKER_PATH], { stdio: ['pipe', 'pipe', 'ignore'], env: process.env });
    } catch {
      done(null); return;
    }
    const kill = (): void => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    timer = setTimeout(() => { kill(); done(null); }, timeoutMs);

    const chunks: Buffer[] = [];
    let total = 0;
    child.stdout?.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_PNG_BYTES) { kill(); done(null); return; } // 과대출력 방어(should-fix)
      chunks.push(c);
    });
    // ★ 미처리 error 이벤트는 부모를 죽인다 → 모든 스트림·프로세스 error 를 흡수(crash-safety 계약). 또한
    //   error 로 조기 귀결 시 자식을 **kill** 해 고아 프로세스(sharp 자식 무기한 잔존)를 막는다(리뷰 must-fix).
    child.stdout?.on('error', () => { kill(); done(null); });
    child.stdin?.on('error', () => { /* 자식 조기종료 시 EPIPE — 흡수(exit/close 핸들러가 결과 판정) */ });
    child.on('error', () => { kill(); done(null); });
    // ★ exit 코드/시그널은 'exit' 에서 캡처하되, **조립은 'close' 에서**(리뷰 must-fix): 'exit' 는 stdout
    //   drain 전에 발화할 수 있어 부분 PNG 를 성공 오판할 수 있다. 'close' 는 모든 stdio 스트림이 닫힌 뒤
    //   (=데이터 완전 수신) 발화하고, crash(SIGABRT) 시에도 스트림이 닫혀 발화하므로 hang 도 없다.
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    child.on('exit', (code, signal) => { exitCode = code; exitSignal = signal; });
    child.on('close', () => {
      // 정상(exit 0·무 signal·데이터 있음)일 때만 PNG. Pango abort(SIGABRT)·비-0 exit·기타 signal = null.
      if (exitCode === 0 && exitSignal === null && chunks.length > 0) done(Buffer.concat(chunks));
      else done(null);
    });

    try {
      child.stdin?.write(svg);
      child.stdin?.end();
    } catch {
      kill(); done(null);
    }
  });
}

// ── 자식 엔트리 (bun <this-file> 로 실행될 때만) ──────────────────────────────────────────────
// stdin 의 SVG 를 읽어 in-process sharp 래스터화 후 stdout 으로 PNG 를 낸다. 여기서 Pango abort 가 나면
// 이 자식만 SIGABRT 로 죽고(부모는 null 감지), 성공하면 flush 후 exit 0.
if (import.meta.main) {
  void (async (): Promise<void> => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      const svg = Buffer.concat(chunks).toString('utf8');
      const { svgToPngBuffer } = await import('../tool-runtime/web-terminal-screenshot.js');
      const png = await svgToPngBuffer(svg); // ← Pango abort 가능 지점(자식 격리라 부모 무해)
      // ★ flush 후 종료(must-fix) — process.exit 는 stdout(파이프) flush 를 안 기다려 PNG 가 잘릴 수 있다.
      //   write 콜백(=완전 flush)에서 exit. 콜백 미발화(부모 소멸) 시엔 부모 timeout 이 kill.
      process.stdout.write(png, () => process.exit(0));
    } catch {
      process.exit(1); // 잡히는 오류(비-abort)는 비-0 exit → 부모가 null
    }
  })();
}
