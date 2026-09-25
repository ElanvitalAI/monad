export const UNOBSERVABLE_DEATHS = ['SIGKILL', 'OOM kill', 'power loss'] as const;

export interface DevCompletionGuardDependencies {
  on(event: 'beforeExit' | 'exit', listener: () => void): void;
  getExitCode(): number | undefined;
  setExitCode(code: number): void;
  writeStderr(line: string): void;
  log(event: string, data: Record<string, unknown>): void;
  flush(): void;
}

export interface DevCompletionGuard {
  conclude(): void;
}

export function shouldReportUnconcludedDevRun(concluded: boolean): boolean {
  return !concluded;
}

export function installDevCompletionGuard(deps: DevCompletionGuardDependencies): DevCompletionGuard {
  let concluded = false;
  let reported = false;

  const report = (phase: 'beforeExit' | 'exit') => {
    if (reported || !shouldReportUnconcludedDevRun(concluded)) return;
    reported = true;
    const unobservableDeaths = [...UNOBSERVABLE_DEATHS];
    const line = `⚠️ [dev completion guard] 결론 없이 종료 중 (${phase}); 못 보는 죽음: ${unobservableDeaths.join(', ')}`;
    // ⛔⭐⭐⭐ 종료 코드 «먼저» 고친다 — 산출보다 앞이다(무인 리뷰 must-fix · `#6976`).
    //   초판은 log→writeStderr→flush 를 «먼저» 부르고 보정을 맨 끝에 뒀다. 그래서 셋 중 하나라도
    //   던지면 «보정까지» 건너뛰고 프로세스가 `exit 0` 으로 나간다 —
    //   ***이 가드가 막으려던 바로 그 상태(조용한 성공 위장)가 재현된다.***
    if (phase === 'beforeExit' && (deps.getExitCode() ?? 0) === 0) deps.setExitCode(1);
    // ⛔ 그리고 각 채널을 «서로 독립»으로 fail-soft 한다 — 하나가 죽어도 나머지는 나간다.
    //   (저장소 기존 규율 = `src/index.ts` dev catch 가 debug.log 를 독립 try 로 감싼 뒤
    //    console.error·exit(1) 을 하는 형태. 같은 형태를 따른다.)
    try { deps.log('completion-missing', { phase, unobservableDeaths }); } catch { /* fail-soft */ }
    try { deps.writeStderr(`${line}\n`); } catch { /* fail-soft */ }
    try { deps.flush(); } catch { /* fail-soft */ }
  };

  deps.on('beforeExit', () => report('beforeExit'));
  deps.on('exit', () => report('exit'));

  return { conclude: () => { concluded = true; } };
}
