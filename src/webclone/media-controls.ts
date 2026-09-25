/**
 * media-controls.ts — ⛔⭐⭐ ***「소리·영상 단추가 «실제로» 되나」*** 하나만 답한다.
 *
 * 🩸 왜 있나(2026-09-11 🅕 · 골프 사이트):
 *    대표 이 「소리도 그렇고 어떻게 해도 너무 느리다」고 했다. 구간별로 재니 ***느린 구간이 없었다***:
 *      문서 FCP 732ms · 오디오 canplaythrough 77ms(742KB) · 영상 4.27MB/1714ms.
 *    그런데 «행위»를 재자 바로 나왔다:
 *      버튼 클릭   play 67ms → **pause 67ms**(같은 밀리초) · currentTime 0 · 소리 «없음»
 *      다른 곳     play 75ms → playing 85ms · currentTime **3.64초** · 소리 «남»
 *    🔑 창 전체에 건 `pointerup` 리스너가 ***버튼 «자신»의 조작까지 먹었다*** —
 *       pointerup 이 켜고, 이어서 click 이 「이미 재생 중이네」 하고 «끈다».
 *    ⇒ ***사람이 누르는 «유일한» 곳에서만*** 안 켜져서 「어떻게 해도 안 된다」로 보였다.
 *
 * ⛔⭐⭐ 그래서 이 자가 «자산화»하는 것은 그 버그가 아니라 ***판정의 «갈래»***다:
 *      「안 난다」를 한 낱말로 두면 ***사람이 할 일이 다른 셋***이 뭉개진다.
 *        self-cancelled  내 코드가 «스스로» 껐다        ⇒ 코드를 고친다
 *        blocked         브라우저 정책이 «막았다»        ⇒ 사용자 조작 경로를 고친다
 *        stalled         받아오다 «멎었다»              ⇒ 자원·네트워크를 본다
 *      ⛔ 셋은 화면에서 «똑같이» 보인다 — 그래서 자가 갈라 줘야 한다.
 *
 * ⛔ 이 자가 «못 보는» 것은 값으로 낸다(`MEDIA_BLIND_SPOTS`).
 */

/** ⛔ 원리상 못 보는 것들 — 「0건」을 「없다」로 읽지 않게 산출에 실린다. */
export const MEDIA_BLIND_SPOTS: readonly string[] = [
  'web-audio: <audio>/<video> 가 아니라 WebAudio 로 내는 소리는 «안 보인다»',
  'shadow-dom-closed: closed shadow root 안의 미디어·단추는 안 보인다',
  'after-interaction: 첫 클릭 «뒤에» 생기는 단추는 이 자가 못 본다 (한 시점만 본다)',
  'muted-autoplay: 소리 없는 자동재생은 «정책상 통과»라 이 자의 판정과 다른 축이다',
  'one-connection: 이 회선에서만 쟀다 — 느린 회선의 stalled 는 여기서 «안 보인다»',
];

/** ⛔ 「켰는데 곧바로 꺼졌다」로 볼 창. 값으로 낸다 — 왜 이 수인지 읽는 쪽이 다시 잴 수 있게. */
export const SELF_CANCEL_WINDOW_MS = 250;
/** 눌렀는데 이만큼 지나도 소리가 «안 흐르면» 못 난 것으로 본다. */
export const PLAY_DEADLINE_MS = 8_000;
/** currentTime 이 이만큼은 전진해야 「났다」고 부른다. ⛔ 0.0 은 「났다」가 아니다. */
export const MIN_ADVANCE_S = 0.15;

export type MediaVerdict =
  | 'plays'           // ✅ 눌렀더니 «실제로» 흘렀다
  | 'self-cancelled'  // 🚨 내 코드가 켜고 «스스로» 껐다
  | 'blocked'         // 브라우저 정책이 막았다(조작이 있었는데도)
  | 'stalled'         // play 는 났는데 흐르지 않았다
  | 'no-control'      // ⚪ 미디어는 있는데 «켜는 단추»를 못 찾았다
  | 'no-media';       // ⚪ 미디어가 «없다»

export interface MediaMark { readonly event: string; readonly ms: number }

export interface MediaProbe {
  /** 어떤 미디어였나 */
  readonly kind: 'audio' | 'video';
  readonly src: string;
  /** 무엇을 눌렀나 — ⛔ 「어떻게 찾았나」를 같이 낸다(휴리스틱임을 숨기지 않는다) */
  readonly control: string | null;
  readonly controlHow: string | null;
  readonly marks: readonly MediaMark[];
  readonly currentTime: number;
  readonly paused: boolean;
  readonly readyState: number;
  /** play() 가 거부됐나 — 거부 사유 문자열(있으면) */
  readonly playRejected: string | null;
}

export interface MediaFinding {
  readonly verdict: MediaVerdict;
  readonly probe: MediaProbe;
  /** ⛔ 왜 그렇게 판정했나 — 한 줄로. 이것이 없으면 판정이 「주장」이 된다. */
  readonly why: string;
  /** 사람이 «무엇을 해야 하나» — 갈래마다 다르다. */
  readonly nextStep: string;
}

const at = (marks: readonly MediaMark[], name: string): number | null => {
  const m = marks.find((x) => x.event === name);
  return m === undefined ? null : m.ms;
};

/**
 * ⛔⭐⭐ 이 자의 «핵심» — 「안 난다」를 «셋»으로 가른다.
 *
 * 🔑 판정 순서가 중요하다: ***self-cancelled 를 «먼저» 본다.***
 *    안 그러면 「play 는 났는데 안 흐른다」가 전부 `stalled` 로 새고,
 *    ***고칠 곳이 「네트워크」로 잘못 지목된다***(골프 사이트에서 실제로 그렇게 보였다).
 */
export function judgeMedia(probe: MediaProbe): MediaFinding {
  const { marks, currentTime, playRejected } = probe;
  const played = currentTime >= MIN_ADVANCE_S && !probe.paused;

  if (played) {
    return {
      verdict: 'plays', probe,
      why: `눌렀더니 ${currentTime}초까지 «실제로» 흘렀다`,
      nextStep: '없음 — 이 단추는 된다.',
    };
  }

  const playAt = at(marks, 'play');
  const pauseAt = at(marks, 'pause');
  // ⛔⭐ 「켜고 «스스로» 껐다」 — 골프 버그의 «지문». 이것을 먼저 본다.
  if (playAt !== null && pauseAt !== null && pauseAt - playAt <= SELF_CANCEL_WINDOW_MS) {
    return {
      verdict: 'self-cancelled', probe,
      why: `play(${playAt}ms) 직후 ${pauseAt - playAt}ms 만에 pause 가 났다 — «내 코드»가 껐다`,
      nextStep:
        '한 조작을 «두 곳»이 처리하고 있는지 보라 — 창 전체 리스너(pointerup 등)와 단추 자신의 onClick 이 '
        + '같은 제스처를 먹으면 하나가 켜고 다른 하나가 끈다. 창 리스너에서 «그 단추 안»의 조작을 뺀다.',
    };
  }

  if (playRejected !== null) {
    return {
      verdict: 'blocked', probe,
      why: `play() 가 거부됐다 — ${playRejected}`,
      nextStep:
        '브라우저 정책이다. ⛔ wheel·scroll 은 사용자 활성화를 «안 준다» — '
        + 'pointerdown/up · mousedown/up · touchend · keydown/up 만 준다. 그 경로로 바꾼다.',
    };
  }

  if (playAt !== null) {
    return {
      verdict: 'stalled', probe,
      why: `play(${playAt}ms) 는 났는데 ${PLAY_DEADLINE_MS}ms 안에 안 흘렀다 (readyState ${probe.readyState})`,
      nextStep: '자원을 보라 — 크기·네트워크·디코드. ⛔ 「느리다」는 여기서만 참이다.',
    };
  }

  return {
    verdict: 'stalled', probe,
    why: 'play 이벤트가 «한 번도» 안 났다 — 단추가 미디어를 안 건드린 것일 수 있다',
    nextStep: '누른 것이 «그 미디어의» 단추가 맞는지 확인하라(controlHow 를 보라).',
  };
}

/** ⛔ 여러 미디어의 판정을 «한 줄»로 요약. 「전부 된다」를 주장으로 두지 않는다. */
export function summariseMedia(findings: readonly MediaFinding[]): string {
  if (findings.length === 0) return '⚪ 미디어가 «없다» — 이 축은 못 쟀다';
  const bad = findings.filter((f) => f.verdict === 'self-cancelled' || f.verdict === 'blocked' || f.verdict === 'stalled');
  const ok = findings.filter((f) => f.verdict === 'plays').length;
  const grey = findings.filter((f) => f.verdict === 'no-control' || f.verdict === 'no-media').length;
  const head = `⇒ 됨 ${ok} · 안 됨 ${bad.length} · ⚪못 쟀음 ${grey} (전체 ${findings.length})`;
  if (bad.length === 0) return head;
  return `${head}\n${bad.map((f) => `  🚨 ${f.verdict}: ${f.why}`).join('\n')}`;
}

/**
 * ⛔⭐ 페이지 «안»에서 도는 계측 표현식. ***누르기 «전»에 심어야 한다*** —
 *    누른 뒤에 심으면 `play`·`pause` 를 놓치고, 그러면 self-cancelled 가 stalled 로 «샌다».
 * ⛔ 정규식·백틱을 이 문자열 안에 두지 않는다(이 저장소가 네 번 밟은 함정).
 */
export function buildMediaArmExpression(): string {
  return `(() => {
  const els = Array.from(document.querySelectorAll('audio, video'));
  window.__mediaProbe = els.map((el, i) => {
    const rec = { i: i, marks: [], t0: performance.now(), rejected: null };
    const push = (name) => rec.marks.push({ event: name, ms: Math.round(performance.now() - rec.t0) });
    const names = ['loadstart','play','playing','pause','waiting','stalled','canplay','canplaythrough','error','ended'];
    for (const n of names) el.addEventListener(n, () => push(n));
    // ⛔ play() 의 «거부»는 이벤트로 안 온다 — 감싸서 잡는다.
    const original = el.play.bind(el);
    el.play = function () {
      const p = original();
      if (p && typeof p.catch === 'function') p.catch((e) => { rec.rejected = String(e && e.name ? e.name : e); });
      return p;
    };
    return rec;
  });
  return String(els.length);
})()`;
}

/** 심어 둔 계측을 «거둔다». ⛔ 미디어와 단추를 «짝지어» 낸다. */
export function buildMediaReadExpression(): string {
  return `(() => {
  const els = Array.from(document.querySelectorAll('audio, video'));
  const recs = window.__mediaProbe || [];
  const out = els.map((el, i) => {
    const rec = recs[i] || { marks: [], rejected: null };
    return {
      kind: el.tagName.toLowerCase(),
      src: String(el.currentSrc || el.src || '').split('/').pop() || '',
      marks: rec.marks,
      currentTime: Math.round(el.currentTime * 100) / 100,
      paused: el.paused,
      readyState: el.readyState,
      playRejected: rec.rejected,
    };
  });
  return JSON.stringify(out);
})()`;
}

/**
 * ⛔⭐ 「이 미디어를 켜는 단추」를 찾는 표현식. ***휴리스틱임을 숨기지 않는다*** —
 *    어떻게 찾았는지(`how`)를 «같이» 낸다. 못 찾으면 null 이고, 그것은 「단추가 없다」가 아니라 「못 찾았다」다.
 */
export function buildControlFindExpression(hints: readonly string[]): string {
  const hintJson = JSON.stringify(hints.map((h) => h.toLowerCase()));
  return `(() => {
  const hints = ${hintJson};
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  const text = (b) => ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).toLowerCase();
  const visible = (b) => {
    const cs = getComputedStyle(b);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const shown = buttons.filter(visible);
  // ① aria-pressed 를 가진 단추 — 「켜짐/꺼짐」을 스스로 말하는 것이 가장 강한 신호다
  let hit = shown.find((b) => b.hasAttribute('aria-pressed'));
  let how = 'aria-pressed 를 가진 첫 단추';
  // ② 낱말로 — ⛔ 낱말 목록은 «인자»로 받는다(여기 박아 두면 늙는다)
  if (!hit) {
    hit = shown.find((b) => hints.some((h) => text(b).indexOf(h) >= 0));
    how = '이름·라벨에 힌트 낱말이 든 첫 단추';
  }
  // ③ 미디어와 «같은 부모» 안에 있는 단추
  if (!hit) {
    const media = document.querySelector('audio, video');
    if (media && media.parentElement) {
      hit = Array.from(media.parentElement.querySelectorAll('button')).filter(visible)[0];
      how = '미디어와 같은 부모 안의 첫 단추';
    }
  }
  if (!hit) return JSON.stringify({ found: false });
  const r = hit.getBoundingClientRect();
  return JSON.stringify({
    found: true, how: how,
    label: (hit.getAttribute('aria-label') || hit.textContent || '').trim().slice(0, 40),
    x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
  });
})()`;
}

/** ⛔ 힌트 낱말 — «값으로» 내보낸다. 늘리려면 여기서. */
export const CONTROL_HINTS: readonly string[] = [
  '소리', '음악', '재생', '켜기', '끄기', 'bgm', 'sound', 'music', 'play', 'audio', 'mute', 'unmute',
];
