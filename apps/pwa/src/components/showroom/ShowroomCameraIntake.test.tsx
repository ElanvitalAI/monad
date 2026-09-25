// CV-3 mobile-readiness #4 · ShowroomCameraIntake render contract.
//
// Pattern mirror: HitlBanner.test.tsx · IntentPanel.test.tsx —
// renderToStaticMarkup, structural markers a future broken
// renderer would lose. Interaction (file pick, route submit) is
// covered by the helper-level suite (camera-intake.test.ts).

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShowroomCameraIntakeView } from './ShowroomCameraIntake';

const noop = (): void => {};

describe('ShowroomCameraIntakeView render contract', () => {
  it('renders camera button only (no modal) when pendingFile=null', () => {
    const html = renderToStaticMarkup(
      <ShowroomCameraIntakeView
        pendingFile={null}
        pendingPreviewUrl={null}
        caption=""
        busy={false}
        error={null}
        onPickFile={noop}
        onCaptionChange={noop}
        onRouteSession={noop}
        onRouteIntake={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-camera-button"/);
    expect(html).not.toMatch(/data-testid="showroom-camera-modal"/);
    expect(html).not.toMatch(/data-testid="showroom-camera-cancel"/);
  });

  it('renders modal with preview + caption + 2 routes when pendingFile set', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(
      <ShowroomCameraIntakeView
        pendingFile={file}
        pendingPreviewUrl="blob:abc"
        caption="my note"
        busy={false}
        error={null}
        onPickFile={noop}
        onCaptionChange={noop}
        onRouteSession={noop}
        onRouteIntake={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-camera-modal"/);
    expect(html).toMatch(/data-testid="showroom-camera-preview"/);
    expect(html).toMatch(/src="blob:abc"/);
    expect(html).toMatch(/data-testid="showroom-camera-caption"/);
    expect(html).toContain('my note');
    expect(html).toMatch(/data-testid="showroom-camera-route-session"/);
    expect(html).toMatch(/data-testid="showroom-camera-route-intake"/);
    expect(html).toMatch(/data-testid="showroom-camera-cancel"/);
    expect(html).toContain('Session 첨부');
    expect(html).toContain('Intake 저장');
  });

  it('omits preview img when pendingPreviewUrl=null (SSR / no DOM)', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(
      <ShowroomCameraIntakeView
        pendingFile={file}
        pendingPreviewUrl={null}
        caption=""
        busy={false}
        error={null}
        onPickFile={noop}
        onCaptionChange={noop}
        onRouteSession={noop}
        onRouteIntake={noop}
        onCancel={noop}
      />,
    );
    expect(html).not.toMatch(/data-testid="showroom-camera-preview"/);
  });

  it('disables every control while busy', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(
      <ShowroomCameraIntakeView
        pendingFile={file}
        pendingPreviewUrl="blob:y"
        caption="x"
        busy
        error={null}
        onPickFile={noop}
        onCaptionChange={noop}
        onRouteSession={noop}
        onRouteIntake={noop}
        onCancel={noop}
      />,
    );
    for (const id of ['showroom-camera-route-session', 'showroom-camera-route-intake', 'showroom-camera-cancel', 'showroom-camera-caption']) {
      expect(html).toMatch(new RegExp(`<(button|textarea)[^>]*disabled[^>]*data-testid="${id}"`));
    }
  });

  it('renders error block when error set', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(
      <ShowroomCameraIntakeView
        pendingFile={file}
        pendingPreviewUrl="blob:z"
        caption=""
        busy={false}
        error="upload 실패: HTTP 413"
        onPickFile={noop}
        onCaptionChange={noop}
        onRouteSession={noop}
        onRouteIntake={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-camera-error"/);
    expect(html).toContain('HTTP 413');
    expect(html).toMatch(/role="alert"/);
  });

  it('aria-modal=true on the dialog wrapper', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(
      <ShowroomCameraIntakeView
        pendingFile={file}
        pendingPreviewUrl="blob:w"
        caption=""
        busy={false}
        error={null}
        onPickFile={noop}
        onCaptionChange={noop}
        onRouteSession={noop}
        onRouteIntake={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"/);
  });
});
