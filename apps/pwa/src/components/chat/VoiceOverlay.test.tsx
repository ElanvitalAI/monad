// Phase 3 (PWA chat ↔ voice 일원화 · 2026-05-07) — VoiceOverlay
// render contract. PWA bun test env has no React Testing Library, so
// we drive the component through `react-dom/server.renderToStaticMarkup`
// and grep the resulting HTML for the structural markers a future
// broken renderer would lose:
//   - aria-hidden flips with `active`
//   - opacity / pointer-events classes flip with `active`
//   - phase headline / hint / dot color render
//   - errorMsg text appears when present, omitted when null
//   - mic toggle button is present + carries the data-elanous-action hook

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { VoiceOverlay } from './VoiceOverlay';

describe('VoiceOverlay — render contract (Phase 3 · C2)', () => {
  it('hidden state — aria-hidden=true · opacity-0 · pointer-events-none', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay active={false} phase="idle" errorMsg={null} onToggle={() => {}} />,
    );
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html).toMatch(/opacity-0/);
    // The hidden state should NOT pin pointer-events-auto open.
    expect(html).not.toMatch(/pointer-events-auto/);
  });

  it('visible state — aria-hidden=false · opacity-100 · pointer-events-auto', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay active phase="listening" errorMsg={null} onToggle={() => {}} />,
    );
    expect(html).toMatch(/aria-hidden="false"/);
    expect(html).toMatch(/opacity-100/);
    expect(html).toMatch(/pointer-events-auto/);
  });

  it('listening phase — emerald dot + headline + hint', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay active phase="listening" errorMsg={null} onToggle={() => {}} />,
    );
    expect(html).toContain('듣는 중');
    expect(html).toContain('자동으로 전송');
    expect(html).toMatch(/bg-emerald-500/);
  });

  it('error phase — surfaces errorMsg + headline switches to "음성 오류"', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay
        active
        phase="error"
        errorMsg="getUserMedia denied"
        onToggle={() => {}}
      />,
    );
    expect(html).toContain('음성 오류');
    expect(html).toContain('getUserMedia denied');
    expect(html).toMatch(/bg-rose-/);
  });

  it('errorMsg=null suppresses the error paragraph', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay active phase="listening" errorMsg={null} onToggle={() => {}} />,
    );
    // No rose-foreground rose-500 text paragraph should render with
    // null errorMsg.
    expect(html).not.toMatch(/text-rose-500"[^>]*>[^<]+<\/p>/);
  });

  it('exposes the mic toggle button via data-elanous-action="voice-overlay-toggle"', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay active phase="listening" errorMsg={null} onToggle={() => {}} />,
    );
    expect(html).toContain('data-elanous-action="voice-overlay-toggle"');
  });

  it('connecting phase — sky dot + spinner icon', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay active phase="connecting" errorMsg={null} onToggle={() => {}} />,
    );
    expect(html).toContain('데몬 연결');
    expect(html).toMatch(/animate-spin/);
  });

  // Phase 5 — TTS mute toggle in voice card.
  it('renders TTS mute toggle when ttsSupported=true + onTtsToggle present', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay
        active
        phase="listening"
        errorMsg={null}
        onToggle={() => {}}
        ttsSupported
        ttsMuted={false}
        onTtsToggle={() => {}}
      />,
    );
    expect(html).toContain('data-elanous-action="voice-overlay-tts-toggle"');
    expect(html).toContain('음성 응답 ON');
    // aria-pressed=true (= 음소거 OFF · 발화 켜짐).
    expect(html).toMatch(/aria-pressed="true"/);
  });

  it('toggle label flips to "음성 응답 OFF" when ttsMuted=true · aria-pressed=false', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay
        active
        phase="listening"
        errorMsg={null}
        onToggle={() => {}}
        ttsSupported
        ttsMuted
        onTtsToggle={() => {}}
      />,
    );
    expect(html).toContain('음성 응답 OFF');
    expect(html).toMatch(/aria-pressed="false"/);
  });

  it('omits TTS toggle entirely when ttsSupported=false (browser 미지원)', () => {
    const html = renderToStaticMarkup(
      <VoiceOverlay
        active
        phase="listening"
        errorMsg={null}
        onToggle={() => {}}
        ttsSupported={false}
        ttsMuted={false}
        onTtsToggle={() => {}}
      />,
    );
    expect(html).not.toContain('voice-overlay-tts-toggle');
    expect(html).not.toContain('음성 응답');
  });
});
