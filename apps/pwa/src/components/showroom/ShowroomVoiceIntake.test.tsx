// CV-3 mobile-readiness #3 · ShowroomVoiceIntakeView render contract.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShowroomVoiceIntakeView } from './ShowroomVoiceIntake';

const noop = (): void => {};

describe('ShowroomVoiceIntakeView render contract', () => {
  it('renders mic button only in idle phase', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="idle"
        transcript=""
        onTranscriptChange={noop}
        error={null}
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-voice-button"/);
    expect(html).toMatch(/data-phase="idle"/);
    expect(html).not.toMatch(/data-testid="showroom-voice-modal"/);
  });

  it('shows recording phase with pulse animation', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="recording"
        transcript="안녕"
        onTranscriptChange={noop}
        error={null}
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-phase="recording"/);
    expect(html).toContain('animate-pulse');
    expect(html).toContain('bg-red-500');
    // No modal during recording — review modal shows post-stop.
    expect(html).not.toMatch(/data-testid="showroom-voice-modal"/);
  });

  it('shows review modal with transcript editor', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="review"
        transcript="안녕하세요"
        onTranscriptChange={noop}
        error={null}
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-voice-modal"/);
    expect(html).toMatch(/data-testid="showroom-voice-transcript"/);
    expect(html).toContain('안녕하세요');
    expect(html).toMatch(/data-testid="showroom-voice-confirm"/);
    expect(html).toMatch(/data-testid="showroom-voice-discard"/);
    expect(html).toMatch(/data-testid="showroom-voice-cancel"/);
    expect(html).toContain('Intake 저장');
    expect(html).toContain('버리기');
  });

  it('disables confirm button when transcript is empty', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="review"
        transcript="   "
        onTranscriptChange={noop}
        error={null}
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="showroom-voice-confirm"/);
  });

  it('disables every control while submitting', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="submitting"
        transcript="hello"
        onTranscriptChange={noop}
        error={null}
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    for (const id of ['showroom-voice-confirm', 'showroom-voice-discard', 'showroom-voice-cancel', 'showroom-voice-transcript']) {
      expect(html).toMatch(new RegExp(`<(button|textarea)[^>]*disabled[^>]*data-testid="${id}"`));
    }
  });

  it('disables mic button when API unavailable + uses no-support label', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="idle"
        transcript=""
        onTranscriptChange={noop}
        error={null}
        apiAvailable={false}
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="showroom-voice-button"/);
    expect(html).toContain('브라우저 미지원');
  });

  it('renders error block in review phase', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="review"
        transcript="hello"
        onTranscriptChange={noop}
        error="intake 실패: HTTP 500"
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-voice-error"/);
    expect(html).toContain('HTTP 500');
    expect(html).toMatch(/role="alert"/);
  });

  it('aria-modal=true on the dialog wrapper', () => {
    const html = renderToStaticMarkup(
      <ShowroomVoiceIntakeView
        phase="review"
        transcript="hello"
        onTranscriptChange={noop}
        error={null}
        apiAvailable
        onPressStart={noop}
        onPressEnd={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"/);
  });
});
