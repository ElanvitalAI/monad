import { describe, expect, test } from 'bun:test';
import {
  judgeMedia, summariseMedia, buildMediaArmExpression, buildMediaReadExpression,
  buildControlFindExpression, CONTROL_HINTS, MEDIA_BLIND_SPOTS,
  SELF_CANCEL_WINDOW_MS, MIN_ADVANCE_S, type MediaProbe,
} from './media-controls.js';

const probe = (over: Partial<MediaProbe> = {}): MediaProbe => ({
  kind: 'audio', src: 'bgm.m4a', control: '가을 아침', controlHow: 'aria-pressed 를 가진 첫 단추',
  marks: [], currentTime: 0, paused: true, readyState: 4, playRejected: null, ...over,
});

describe('⛔⭐⭐ 「안 난다」를 «셋»으로 가른다 — 사람이 할 일이 다르다', () => {
  // 📏 골프 사이트 실측 그대로: play 67ms → pause 67ms · currentTime 0
  test('🩸 켜고 «스스로» 껐으면 self-cancelled — 골프 버그의 지문', () => {
    const f = judgeMedia(probe({ marks: [{ event: 'play', ms: 67 }, { event: 'pause', ms: 67 }] }));
    expect(f.verdict).toBe('self-cancelled');
    expect(f.why).toContain('내 코드');
    expect(f.nextStep).toContain('두 곳');
  });

  test('정책이 막았으면 blocked — ⛔ self-cancelled 와 «다른 값»', () => {
    const f = judgeMedia(probe({ marks: [{ event: 'play', ms: 40 }], playRejected: 'NotAllowedError' }));
    expect(f.verdict).toBe('blocked');
    expect(f.nextStep).toContain('wheel·scroll');
  });

  test('받아오다 멎었으면 stalled — ⛔ 위 둘과 «또 다른 값»', () => {
    const f = judgeMedia(probe({ marks: [{ event: 'play', ms: 40 }, { event: 'waiting', ms: 41 }] }));
    expect(f.verdict).toBe('stalled');
    expect(f.nextStep).toContain('자원');
  });

  // ⛔ 판별 검사 ⓑ: 「전부 stalled 를 내는」 구현으로는 이 줄을 못 지난다.
  test('셋이 «실제로» 다른 값이다', () => {
    const v = new Set([
      judgeMedia(probe({ marks: [{ event: 'play', ms: 10 }, { event: 'pause', ms: 12 }] })).verdict,
      judgeMedia(probe({ marks: [{ event: 'play', ms: 10 }], playRejected: 'NotAllowedError' })).verdict,
      judgeMedia(probe({ marks: [{ event: 'play', ms: 10 }] })).verdict,
    ]);
    expect(v.size).toBe(3);
  });

  test('⛔⭐ 판정 «순서» — self-cancelled 를 먼저 본다', () => {
    // 켜고 껐는데 거부 사유도 있는 경우: 고칠 곳은 «내 코드»다.
    const f = judgeMedia(probe({
      marks: [{ event: 'play', ms: 20 }, { event: 'pause', ms: 30 }],
      playRejected: 'NotAllowedError',
    }));
    expect(f.verdict).toBe('self-cancelled');
  });

  test('⛔ 창 밖에서 난 pause 는 self-cancelled 가 «아니다» — 사람이 끈 것일 수 있다', () => {
    const f = judgeMedia(probe({
      marks: [{ event: 'play', ms: 20 }, { event: 'pause', ms: 20 + SELF_CANCEL_WINDOW_MS + 1 }],
    }));
    expect(f.verdict).not.toBe('self-cancelled');
  });
});

describe('⛔ 「났다」는 «흘렀을» 때만이다', () => {
  test('currentTime 이 전진하고 안 멈춰 있으면 plays', () => {
    const f = judgeMedia(probe({ currentTime: 3.61, paused: false, marks: [{ event: 'play', ms: 75 }, { event: 'playing', ms: 123 }] }));
    expect(f.verdict).toBe('plays');
    expect(f.why).toContain('3.61');
  });

  test('⛔ currentTime 0 은 「났다」가 «아니다»', () => {
    expect(judgeMedia(probe({ currentTime: 0, paused: false })).verdict).not.toBe('plays');
  });

  test('⛔ 아주 조금 흐른 것도 「났다」가 아니다 — 임계를 값으로 낸다', () => {
    expect(judgeMedia(probe({ currentTime: MIN_ADVANCE_S / 2, paused: false })).verdict).not.toBe('plays');
    expect(judgeMedia(probe({ currentTime: MIN_ADVANCE_S, paused: false })).verdict).toBe('plays');
  });

  test('⛔ 흘렀어도 «멈춰 있으면» plays 가 아니다', () => {
    expect(judgeMedia(probe({ currentTime: 5, paused: true })).verdict).not.toBe('plays');
  });
});

describe('요약 — ⛔ 「전부 된다」를 주장으로 두지 않는다', () => {
  test('미디어가 없으면 «못 쟀다»고 말한다 — 「전부 된다」가 아니다', () => {
    expect(summariseMedia([])).toContain('못 쟀다');
  });

  test('안 되는 것이 있으면 «무엇이» 안 되는지 줄로 낸다', () => {
    const s = summariseMedia([
      judgeMedia(probe({ currentTime: 2, paused: false })),
      judgeMedia(probe({ marks: [{ event: 'play', ms: 5 }, { event: 'pause', ms: 6 }] })),
    ]);
    expect(s).toContain('됨 1');
    expect(s).toContain('안 됨 1');
    expect(s).toContain('self-cancelled');
  });

  test('전부 되면 줄이 «안 붙는다»(소음 금지)', () => {
    const s = summariseMedia([judgeMedia(probe({ currentTime: 2, paused: false }))]);
    expect(s).toContain('안 됨 0');
    expect(s).not.toContain('🚨');
  });
});

describe('⛔ 페이지 표현식 — 브라우저가 «그대로» 실행한다', () => {
  test('셋 다 문법이 성립한다', () => {
    for (const src of [buildMediaArmExpression(), buildMediaReadExpression(), buildControlFindExpression(CONTROL_HINTS)]) {
      expect(() => new Function(`return ${src}`)).not.toThrow();
    }
  });

  test('⛔ 정규식·백틱을 문자열 안에 두지 않는다(이 저장소가 네 번 밟은 함정)', () => {
    for (const src of [buildMediaArmExpression(), buildMediaReadExpression(), buildControlFindExpression(CONTROL_HINTS)]) {
      expect(src).not.toContain('`');
    }
  });

  test('힌트 낱말이 «인자»로 들어간다 — 박아 두면 늙는다', () => {
    expect(buildControlFindExpression(['zzz'])).toContain('zzz');
    expect(buildControlFindExpression(['zzz'])).not.toContain('소리');
  });

  test('⛔ 자기 «사각»을 값으로 낸다', () => {
    expect(MEDIA_BLIND_SPOTS.length).toBeGreaterThan(0);
    expect(MEDIA_BLIND_SPOTS.join(' ')).toContain('web-audio');
  });
});
