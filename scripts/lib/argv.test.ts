// ⛔⭐ 인자 계약의 «단위» 시험 — CLI 를 spawn 하는 시험과 «다른 층»이다.
//   📏 8차 리뷰에서 배운 것: CLI 가 막아 준다고 라이브러리 계약이 옳은 것은 아니다.
//   ⇒ 여기서는 계약 자체를 in-process 로 누른다(빠르고, 종료코드가 아니라 «이유»를 본다).
import { describe, expect, it } from 'bun:test';
import { parseArgv, type FlagKind } from './argv.js';

const KNOWN: Record<string, FlagKind> = {
  '--json': 'bool', '--need': 'value', '--config': 'value',
};

const errs = (argv: string[], allowed?: readonly string[]): readonly string[] =>
  parseArgv(argv, { known: KNOWN, allowed, label: 'plan' }).errors;

describe('parseArgv — 값 읽기', () => {
  it('두 철자를 «같게» 읽는다', () => {
    expect(parseArgv(['--need', 'a'], { known: KNOWN }).values.need).toBe('a');
    expect(parseArgv(['--need=a'], { known: KNOWN }).values.need).toBe('a');
  });

  it('플래그의 값을 positional 로 흘리지 않는다', () => {
    const r = parseArgv(['--need', 'a', 'file.yaml'], { known: KNOWN, allowPositional: true });
    expect(r.positional).toEqual(['file.yaml']);
    expect(r.errors).toHaveLength(0);
  });

  // ⛔⭐ 11차 리뷰 ① GOODHART — `--json=1` 만 막고 `--json 값` 은 안 막았다.
  //   띄어 쓴 값이 positional 로 «조용히» 흘러 무시됐고, 내 시험은 붙여 쓴 쪽만 봤다.
  it('positional 은 «기본 거부»다 — 받는 입구만 켠다', () => {
    expect(parseArgv(['--json', '값'], { known: KNOWN }).errors).toHaveLength(1);
  });

  // ⛔⭐ 19차 리뷰 — ***이 조합은 「계약 구멍」이 아니라 「의도된 모호함」이다.*** 못 박아 둔다:
  //   allowPositional 을 켠 입구에서 bool 뒤의 토큰은 «그 bool 의 값»이 아니라 «위치 인자»다.
  //   ⇒ 그 입구는 파일을 받으려고 켠 것이고(`--index file.yaml`), 그것이 문서화된 용법이다.
  //   📌 감수할 수 없으면 그 입구는 bool 을 더하지 말거나 값을 `--k=v` 로만 받아야 한다.
  it('positional 을 켠 입구에서 bool 뒤 토큰은 «위치 인자»다 — 의도된 모호함', () => {
    const r = parseArgv(['--json', 'file.yaml'], { known: KNOWN, allowPositional: true });
    expect(r.errors).toHaveLength(0);
    expect(r.flags.has('json')).toBe(true);
    expect(r.positional).toEqual(['file.yaml']);   // ⭐ 「값으로 먹지 않는다」가 계약이다
  });

  it('bool 은 나타남으로 읽는다', () => {
    expect(parseArgv(['--json'], { known: KNOWN }).flags.has('json')).toBe(true);
    expect(parseArgv([], { known: KNOWN }).flags.has('json')).toBe(false);
  });
});

describe('parseArgv — ⛔ 빨간 길(여덟 판에 걸쳐 여섯 철자로 살아남은 것들)', () => {
  it('값 누락 — 세 철자 전부', () => {
    expect(errs(['--need'])).toHaveLength(1);
    expect(errs(['--need='])).toHaveLength(1);
    expect(errs(['--need', '='])).toHaveLength(1);
  });

  it('값 자리에 «다음 플래그»가 오면 값이 아니다', () => {
    expect(errs(['--need', '--json'])).toHaveLength(1);
  });

  it('중복은 값·bool 둘 다 거부한다 — 예외를 두면 그 예외가 다음 결함이다', () => {
    expect(errs(['--need', 'a', '--need', 'b'])).toHaveLength(1);
    expect(errs(['--need=a', '--need=b'])).toHaveLength(1);
    expect(errs(['--json', '--json'])).toHaveLength(1);
  });

  it('bool 에 값을 주면 거부한다', () => {
    expect(errs(['--json=1'])).toHaveLength(1);
  });

  it('모르는 플래그를 거부한다', () => {
    expect(errs(['--nope', 'v'])).toHaveLength(1);
  });

  it('서브커맨드가 안 받는 플래그를 거부한다', () => {
    expect(errs(['--config', 'x'], ['--json'])).toHaveLength(1);
    expect(errs(['--json'], ['--json'])).toHaveLength(0);
  });

  it('오류를 «모아서» 낸다 — 첫 하나만 보고 고치면 다음 판에 또 온다', () => {
    expect(errs(['--nope', '--need', '--json', '--json']).length).toBeGreaterThan(1);
  });
});
