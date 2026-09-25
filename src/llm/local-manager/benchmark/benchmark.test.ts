import { describe, it, expect } from 'bun:test';
import { runPython, extractCodeBlock, tallyMarkers } from './code-exec.js';
import { BENCH_TASKS, categoryMaxes, extractAnswerTag, RUBRIC_VERSION } from './tasks.js';
import { benchmarkModel } from './runner.js';
import { formatScorecard, formatRanking, scorecardToRecord } from './format.js';

const realExec = (source: string) => runPython(source, { timeoutMs: 15_000 });

// 각 코딩 태스크의 참조 정답(만점 나와야 = 드라이버 정합 검증). v2(2026-07-20): 하드 문항 eval-expr·min-coins 추가.
const REF: Record<string, string> = {
  'coding.interval-merge': '```python\ndef merge_intervals(intervals):\n    xs = sorted([list(x) for x in intervals])\n    out = []\n    for s, e in xs:\n        if out and s <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], e)\n        else:\n            out.append([s, e])\n    return out\n```',
  'coding.csv-parse': '```python\ndef parse_csv_line(line):\n    out = []; field = []; i = 0; n = len(line); in_q = False\n    while i < n:\n        ch = line[i]\n        if in_q:\n            if ch == \'"\':\n                if i+1 < n and line[i+1] == \'"\': field.append(\'"\'); i += 2; continue\n                in_q = False; i += 1; continue\n            field.append(ch); i += 1\n        else:\n            if ch == \'"\': in_q = True; i += 1\n            elif ch == \',\': out.append("".join(field)); field = []; i += 1\n            else: field.append(ch); i += 1\n    out.append("".join(field))\n    return out\n```',
  'coding.regex-match': '```python\nimport functools\ndef regex_match(s, p):\n    @functools.lru_cache(None)\n    def dp(i, j):\n        if j == len(p): return i == len(s)\n        first = i < len(s) and p[j] in (s[i], ".")\n        if j+1 < len(p) and p[j+1] == "*":\n            return dp(i, j+2) or (first and dp(i+1, j))\n        return first and dp(i+1, j+1)\n    return dp(0, 0)\n```',
  'coding.eval-expr': '```python\ndef eval_expr(expr):\n    s = expr.replace(" ", ""); pos = 0\n    def peek(): return s[pos] if pos < len(s) else ""\n    def pe():\n        nonlocal pos\n        v = pt()\n        while peek() in ("+", "-"):\n            op = s[pos]; pos += 1; r = pt(); v = v + r if op == "+" else v - r\n        return v\n    def pt():\n        nonlocal pos\n        v = pf()\n        while peek() in ("*", "/"):\n            op = s[pos]; pos += 1; r = pf()\n            if op == "*": v = v * r\n            else:\n                q = abs(v) // abs(r); v = q if (v < 0) == (r < 0) else -q\n        return v\n    def pf():\n        nonlocal pos\n        if peek() == "+": pos += 1; return pf()\n        if peek() == "-": pos += 1; return -pf()\n        if peek() == "(": pos += 1; v = pe(); pos += 1; return v\n        st = pos\n        while pos < len(s) and s[pos].isdigit(): pos += 1\n        return int(s[st:pos])\n    return pe()\n```',
  'coding.min-coins': '```python\ndef min_coins(coins, amount):\n    INF = float("inf"); dp = [0] + [INF] * amount\n    for a in range(1, amount + 1):\n        for c in coins:\n            if c <= a and dp[a - c] + 1 < dp[a]: dp[a] = dp[a - c] + 1\n    return dp[amount] if dp[amount] != INF else -1\n```',
};

const REF_NONCODE: Record<string, string> = {
  'reasoning.schedule': '풀이 생략.\nANSWER: Mon=A,Tue=C,Wed=D,Thu=B,Fri=E,Sat=F,Sun=G',
  'reasoning.sequence': '2,2,1,-2,-9,-24,-55,-118.\nANSWER: a6=-24,a8=-118',
  'reasoning.deduction': 'Q=T·R=T·S=L·P=L 이 유일 정합.\nANSWER: P=L,Q=T,R=T,S=L',
  'rag.reject-production': '근거: "프로덕션 라우팅 변경은 병합 전에 반드시 리뷰 게이트 승인을 거쳐야 한다."\nVERDICT: REJECT',
  'rag.approve-typo': '근거: "문서 오탈자 수정은 리뷰 없이 병합 가능하다."\nVERDICT: APPROVE',
  'kr-format.four-line': '원인: 배포 출처 미확인\n위험: 변경 기록 누락\n조치: 사전 검증 절차 추가\n확인: 담당자 승인 보류',
};

function refAnswer(taskId: string): string {
  return REF[taskId] ?? REF_NONCODE[taskId] ?? '';
}

describe('code-exec', () => {
  it('runPython — stdout 캡처·exit 0', async () => {
    const r = await runPython('print("hi"); print(1+1)');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('hi');
    expect(r.stdout).toContain('2');
  });
  it('runPython — 무한루프 타임아웃 kill', async () => {
    const r = await runPython('while True: pass', { timeoutMs: 800 });
    expect(r.timedOut).toBe(true);
  });
  it('extractCodeBlock — python 펜스 추출', () => {
    expect(extractCodeBlock('설명\n```python\nx=1\n```\n끝')).toBe('x=1');
    expect(extractCodeBlock('def f(): pass')).toBe('def f(): pass');
  });
  it('tallyMarkers — PASS/FAIL 집계', () => {
    const t = tallyMarkers('__PASS__ a\n__FAIL__ b\n__PASS__ c\nnoise');
    expect(t.passed).toBe(2);
    expect(t.failed).toBe(1);
    expect(t.failedNames).toEqual(['b']);
  });
});

describe('coding 태스크 — 참조 정답 만점(드라이버 정합)', () => {
  for (const task of BENCH_TASKS.filter((t) => t.category === 'coding')) {
    it(`${task.id} — 정답 → 만점 ${task.max}`, async () => {
      const g = await task.grade(refAnswer(task.id), realExec);
      expect(g.score).toBe(task.max);
    }, 20_000);
  }
  it('오답(빈 함수) → 0점 또는 감점', async () => {
    const bad = '```python\ndef merge_intervals(intervals):\n    return []\n```';
    const g = await BENCH_TASKS[0]!.grade(bad, realExec);
    expect(g.score).toBeLessThan(BENCH_TASKS[0]!.max);
  }, 20_000);
  it('함수 미정의 → 0점', async () => {
    const g = await BENCH_TASKS[0]!.grade('그냥 설명만 함', realExec);
    expect(g.score).toBe(0);
  });
});

describe('추론/RAG/형식 채점기', () => {
  it('extractAnswerTag — 마지막 ANSWER 값', () => {
    expect(extractAnswerTag('ANSWER: x\n중간\nANSWER: 최종')).toBe('최종');
    expect(extractAnswerTag('없음')).toBeNull();
  });
  for (const task of BENCH_TASKS.filter((t) => t.category !== 'coding')) {
    it(`${task.id} — 정답 → 만점`, async () => {
      const g = await task.grade(refAnswer(task.id), realExec);
      expect(g.score).toBe(task.max);
    });
  }
  it('schedule 부분정답 → 부분점수(7분할)', async () => {
    const g = await BENCH_TASKS.find((t) => t.id === 'reasoning.schedule')!.grade('ANSWER: Mon=A,Tue=C,Wed=D,Thu=X,Fri=X,Sat=X,Sun=X', realExec);
    expect(g.score).toBeGreaterThan(0);
    expect(g.score).toBeLessThan(10);
  });
  it('sequence 부분정답 → 부분점수(2분할)', async () => {
    const g = await BENCH_TASKS.find((t) => t.id === 'reasoning.sequence')!.grade('ANSWER: a6=-24,a8=999', realExec);
    expect(g.score).toBe(5); // a6만 정답
  });
  it('deduction 부분정답 → 부분점수(4분할 granularity)', async () => {
    const g = await BENCH_TASKS.find((t) => t.id === 'reasoning.deduction')!.grade('ANSWER: P=L,Q=T,R=T,S=T', realExec);
    expect(g.score).toBe(8); // 3/4 정답 → round(7.5)
  });
  it('deduction 꺾쇠 echo(`P=<L>`) 도 정답 처리 — 라이브 회귀(ornith)', async () => {
    // 모델이 프롬프트 템플릿 `<T|L>` 의 꺾쇠를 그대로 echo 해도 올바른 답이면 만점.
    const g = await BENCH_TASKS.find((t) => t.id === 'reasoning.deduction')!.grade('ANSWER: P=<L>,Q=<T>,R=<T>,S=<L>', realExec);
    expect(g.score).toBe(10);
  });
  it('schedule/RAG 꺾쇠 echo 관대', async () => {
    const s = await BENCH_TASKS.find((t) => t.id === 'reasoning.schedule')!.grade('ANSWER: Mon=<A>,Tue=<C>,Wed=<D>,Thu=<B>,Fri=<E>,Sat=<F>,Sun=<G>', realExec);
    expect(s.score).toBe(10);
    const r = await BENCH_TASKS.find((t) => t.id === 'rag.reject-production')!.grade('리뷰 게이트 근거.\nVERDICT: <REJECT>', realExec);
    expect(r.score).toBe(5);
  });
  it('kr-format 영문 섞이면 감점', async () => {
    const g = await BENCH_TASKS.find((t) => t.id === 'kr-format.four-line')!.grade('원인: source 출처\n위험: 기록\n조치: 검증\n확인: 보류', realExec);
    expect(g.score).toBeLessThan(10);
  });
  it('rag 근거인용 O·판정 오답 → 부분점수(인용만)', async () => {
    const g = await BENCH_TASKS.find((t) => t.id === 'rag.reject-production')!.grade('리뷰 게이트가 있다.\nVERDICT: APPROVE', realExec);
    expect(g.score).toBe(2); // 인용 2 + 오판정 0
  });
  it('rag approve 케이스 — 항상거부 패턴매칭 방지(정답 APPROVE)', async () => {
    const g = await BENCH_TASKS.find((t) => t.id === 'rag.approve-typo')!.grade('근거: 문서 오탈자 수정은 리뷰 없이 병합 가능하다.\nVERDICT: APPROVE', realExec);
    expect(g.score).toBe(5); // 인용 2 + 정판정 3
  });
});

describe('benchmarkModel — 통합', () => {
  it('전부 정답 canned → 100점', async () => {
    let i = 0;
    const chat = async () => refAnswer(BENCH_TASKS[i++]!.id);
    const sc = await benchmarkModel(
      { node: 'test', model: 'ref', endpoint: 'http://x' },
      { chat, exec: realExec, now: () => 1000 },
    );
    expect(sc.total).toBe(100);
    expect(sc.max).toBe(100);
    expect(sc.byCategory.coding.score).toBe(50);
    expect(sc.byCategory.reasoning.score).toBe(30);
  }, 30_000);
  it('chat 예외 → 해당 문항 0·errored·계속 진행', async () => {
    let i = 0;
    const chat = async () => {
      const id = BENCH_TASKS[i++]!.id;
      if (id === 'coding.interval-merge') throw new Error('네트워크 끊김');
      return refAnswer(id);
    };
    const sc = await benchmarkModel(
      { node: 'test', model: 'ref', endpoint: 'http://x' },
      { chat, exec: realExec },
    );
    expect(sc.tasks[0]!.errored).toBe(true);
    expect(sc.tasks[0]!.score).toBe(0);
    expect(sc.total).toBe(90); // 코딩 첫 문항 10점 손실
  }, 30_000);
  it('categoryMaxes 합 = 100', () => {
    const m = categoryMaxes();
    expect(m.coding + m.reasoning + m.rag + m['kr-format']).toBe(100);
  });

  it('tok/s 계측 — chat 이 completionTokens 반환 시 집계', async () => {
    let i = 0;
    let t = 1000;
    const chat = async () => ({ text: refAnswer(BENCH_TASKS[i++]!.id), completionTokens: 100 });
    const sc = await benchmarkModel(
      { node: 'test', model: 'ref', endpoint: 'http://x' },
      { chat, exec: realExec, now: () => (t += 1000) }, // 문항마다 1초 경과
    );
    expect(sc.tokPerSec).toBeGreaterThan(0);
    expect(sc.totalCompletionTokens).toBe(100 * BENCH_TASKS.length);
    expect(sc.tasks[0]!.tokPerSec).toBeCloseTo(100, 0); // 100토큰/1초
  }, 30_000);

  it('문자열 반환 chat(하위호환) → tok/s undefined·정상 채점', async () => {
    let i = 0;
    const chat = async () => refAnswer(BENCH_TASKS[i++]!.id);
    const sc = await benchmarkModel({ node: 'test', model: 'ref', endpoint: 'http://x' }, { chat, exec: realExec });
    expect(sc.tokPerSec).toBeUndefined();
    expect(sc.total).toBe(100);
  }, 30_000);
});

describe('format', () => {
  it('formatScorecard/formatRanking/record 스모크', async () => {
    let i = 0;
    const chat = async () => refAnswer(BENCH_TASKS[i++]!.id);
    const sc = await benchmarkModel({ node: 'node-b', model: 'ref', endpoint: 'http://x' }, { chat, exec: realExec });
    expect(formatScorecard(sc)).toContain('총점 100/100');
    expect(formatRanking([sc])).toContain('🥇');
    const rec = scorecardToRecord(sc, '2026-07-15');
    expect(rec.total).toBe(100);
    expect(rec.rubricVersion).toBe(RUBRIC_VERSION); // v1/v2 스코어 구분 태깅
  }, 30_000);
});

describe('pickMedianCard — 런간 변동 중앙값', () => {
  const mk = (total: number) => ({ target: { node: 'n', model: 'm', endpoint: 'e' }, total } as any);
  it('홀수 N → 중앙값 런 선택 + spread', async () => {
    const { pickMedianCard } = await import('./fleet.js');
    const r = pickMedianCard([mk(60), mk(100), mk(90)]);
    expect(r.median.total).toBe(90); // 정렬 60·90·100 → 중앙 90
    expect(r.spread).toEqual([60, 100]);
    expect(r.runs).toBe(3);
  });
  it('짝수 N → 하위 중앙(결정론)', async () => {
    const { pickMedianCard } = await import('./fleet.js');
    const r = pickMedianCard([mk(80), mk(90)]);
    expect(r.median.total).toBe(80); // floor((2-1)/2)=0 → 정렬 첫째
  });
  it('단일 런 → 그 카드', async () => {
    const { pickMedianCard } = await import('./fleet.js');
    expect(pickMedianCard([mk(77)]).median.total).toBe(77);
  });
});

describe('v2 루브릭 하드닝 속성', () => {
  it('난이도 스프레드 — easy·medium·hard 모두 존재(천장·바닥 변별)', () => {
    const diffs = new Set(BENCH_TASKS.map((t) => t.difficulty));
    expect(diffs.has('easy')).toBe(true);
    expect(diffs.has('medium')).toBe(true);
    expect(diffs.has('hard')).toBe(true);
  });
  it('코딩에 하드 문항 ≥2(천장 포화 방지)', () => {
    const hardCoding = BENCH_TASKS.filter((t) => t.category === 'coding' && t.difficulty === 'hard');
    expect(hardCoding.length).toBeGreaterThanOrEqual(2);
  });
  it('RAG 긍정·부정 양쪽 존재(항상거부 패턴매칭 방지)', () => {
    const rag = BENCH_TASKS.filter((t) => t.category === 'rag').map((t) => t.id);
    expect(rag).toContain('rag.reject-production');
    expect(rag).toContain('rag.approve-typo');
  });
  it('RUBRIC_VERSION 는 v2', () => {
    expect(RUBRIC_VERSION).toContain('v2');
  });
});
