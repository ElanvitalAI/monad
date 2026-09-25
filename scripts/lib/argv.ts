/**
 * 🧾 스크립트 인자 계약 — ***일반 파서다. 영상 전용이 아니다.***
 *
 * 🩸 2026-09-22 자리 정정 (🅢 지적 · 채널 #16815):
 *   이 파일은 `src/video-pipeline/argv.ts` 에 있었고, ***일반 그래프 도구***
 *   (`scripts/check-graph-declaration.ts`)가 ***영상 모듈을 들이고 있었다.***
 *   ⛔ 열어 보니 117줄 중 영상 낱말은 «머리말의 결함 이력» 3줄뿐이고 로직은 100% 범용이다.
 *   ⇒ 🔑 ***얽힌 게 아니라 «자리»가 틀렸다.*** 옮기니 `src/video-pipeline/` 이 100% 분리된다.
 *   ⚠️ 같은 부류가 또 있다 — `conatus-data-dir`(투자 낱말 0인데 도메인 이름을 달았다 · 🅢 ⑶).
 *      ***일반 유틸이 도메인 이름을 달면 「분리 비용」이 실제보다 커 보인다.***
 *
 * ⛔ 아래 결함 이력의 `(video-pipeline.ts)` 표기는 ***그 결함이 «어디서» 났나***이지
 *   이 파일의 «소속»이 아니다. 지우지 않는다 — 계기를 지우면 규칙만 남는다.
 */
export type FlagKind = 'bool' | 'value';

export interface ArgvContract {
  /** 플래그 이름(`--` 포함) → 값을 받나. ⛔ 여기 없는 플래그는 거부된다. */
  readonly known: Readonly<Record<string, FlagKind>>;
  /** 서브커맨드별 허용 목록(없으면 전부 허용). */
  readonly allowed?: readonly string[];
  /** 오류 문면에 쓸 이름(서브커맨드 등). */
  readonly label?: string;
  /**
   * ⛔⭐⭐ 19차 리뷰(should-fix) — ***이 스위치를 켜면 「bool 에 값 부여 ⇒ 2」 계약이 그 입구에서 «없다».***
   *   `--index file.yaml` 에서 `file.yaml` 은 그 bool 의 «값»인지 «파일»인지 원리상 못 가른다.
   *   ⇒ 그 입구는 ***파일을 받으려고*** 켠 것이므로 「파일」로 읽는 것이 맞다(§0 ⑶ 의 문서화된 용법).
   *   📌 그러므로 ***이 스위치를 켠 입구에 bool 플래그를 더할 때는 그 모호함을 감수하는 것***이고,
   *      감수할 수 없으면 그 값을 `--k=v` 로만 받아야 한다. 이 규칙을 시험이 «못 박아» 둔다.
   * ⛔⭐ 11차 리뷰 ① — positional 을 «허용»으로 두면 `probe --json 값` 의 「값」이 조용히 흘러간다.
   *   bool 에 «붙여 쓴» 값(`--json=1`)은 막았는데 «띄어 쓴» 값은 안 막혔다 — 굿하트다.
   *   ⇒ positional 을 받는 입구만 명시적으로 켠다. 기본은 «거부»다.
   */
  readonly allowPositional?: boolean;
}

export interface ParsedArgv {
  /** `--k v` · `--k=v` 로 받은 값. 키는 `--` 없는 이름. */
  readonly values: Readonly<Record<string, string>>;
  /** 나타난 boolean 플래그(`--` 없는 이름). */
  readonly flags: ReadonlySet<string>;
  /** 플래그도 그 값도 아닌 인자. */
  readonly positional: readonly string[];
  /** ⛔ 비어 있지 않으면 호출자는 exit 2 한다. 「경고」가 아니다. */
  readonly errors: readonly string[];
}

export function parseArgv(argv: readonly string[], c: ArgvContract): ParsedArgv {
  const errors: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const positional: string[] = [];
  const seen = new Set<string>();
  const consumed = new Set<number>();
  const where = c.label ? `'${c.label}' 에서 ` : '';

  for (let i = 0; i < argv.length; i++) {
    if (consumed.has(i)) continue;
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      if (c.allowPositional !== true) { errors.push(`${where}남는 인자 '${a}' — 이 명령은 위치 인자를 받지 않는다`); continue; }
      positional.push(a); continue;
    }

    const hasEq = a.includes('=');
    const name = hasEq ? a.slice(0, a.indexOf('=')) : a;
    const kind = c.known[name];

    // ⛔⭐ 오류를 내더라도 «그 플래그의 값처럼 보이는 다음 토큰»은 먹는다.
    //   안 그러면 한 가지 잘못이 「모르는 플래그」 ⊕ 「남는 인자」 ***두 줄***로 보고돼,
    //   사람이 «두 곳»을 고치려 든다. ⇒ 한 잘못은 한 줄로 낸다.
    const eatNext = (): void => {
      const nx = argv[i + 1];
      if (!hasEq && nx !== undefined && !nx.startsWith('--')) consumed.add(i + 1);
    };

    if (kind === undefined) {
      errors.push(`${where}모르는 플래그 '${name}' — 가능: ${Object.keys(c.known).sort().join(' ')}`);
      eatNext();
      continue;
    }
    if (c.allowed && !c.allowed.includes(name)) {
      errors.push(`${where}'${name}' 를 줄 수 없다 — 받는 것: ${c.allowed.length ? c.allowed.join(' ') : '(없음)'}`);
      if (kind === 'value') eatNext();
      continue;
    }
    // ⛔ 중복은 «뒤쪽이 조용히 버려진다». boolean 도 마찬가지로 거부한다 — 예외를 두면 그 예외가 다음 결함이다.
    if (seen.has(name)) {
      errors.push(`${where}${name} 을 두 번 줬다 — 뒤쪽이 «조용히» 버려진다`
        + (kind === 'value' ? ` (여러 값은 쉼표로: ${name} a,b)` : ''));
      if (kind === 'value') eatNext();
      continue;
    }
    seen.add(name);

    if (kind === 'bool') {
      // ⛔ `--json=…` 은 값을 «안 받는» 플래그에 값을 준 것이다. 삼키지 않는다.
      if (hasEq) { errors.push(`${where}${name} 은 값을 받지 않는다`); continue; }
      flags.add(name.slice(2));
      continue;
    }

    const raw = hasEq ? a.slice(a.indexOf('=') + 1) : argv[i + 1];
    if (raw === undefined || raw.startsWith('--') || raw.trim() === '' || raw.trim() === '=') {
      errors.push(`${where}${name} 에 값이 없다`);
      eatNext(); // ⛔ `--need =` 의 '=' 를 「남는 인자」로 또 세지 않는다
      continue;
    }
    if (!hasEq) consumed.add(i + 1);
    values[name.slice(2)] = raw;
  }
  return { values, flags, positional, errors };
}
