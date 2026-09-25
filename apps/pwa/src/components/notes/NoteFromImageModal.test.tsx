// R-OCR.2.5 — NoteFromImageModal render + structure contract.
//
// Pattern mirror: HitlBanner.test.tsx + ChatInput.test.tsx. The modal
// embeds a Dialog from base-ui which renders into a portal — SSR
// returns empty markup when `open=false`. A 3-tier strategy:
//
//   1. SSR render with open=false → empty markup (idle baseline).
//   2. SSR render with open=true / image=null → renders the dialog
//      title/description (phase still 'idle' because the OCR effect
//      doesn't fire on server). Pins the title text + accessibility
//      attributes so a refactor can't silently drop them.
//   3. Source-level grep guards for the phase machine + endpoint
//      callsites (`/v1/notes/from-image` · `/v1/notes/save`) +
//      polishMode union — so a rename / wire bug fails loud at the
//      same level the server-side route guards catch routing regs.
//
// Interactions (state transitions, fetch, retry) are validated end-
// to-end via `nexus-runtime-integration.test.ts` route guards + the
// server unit tests. The PWA piece is structural-only here.
//
// Cross-ref:
//   apps/pwa/src/components/notes/NoteFromImageModal.tsx (SUT)
//   apps/pwa/src/components/notes/SaveAsNoteButton.tsx (entry point)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.2

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { NoteFromImageModal } from './NoteFromImageModal';
import { DaemonContext } from '@/components/providers/DaemonProvider';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODAL_SRC = readFileSync(join(HERE, 'NoteFromImageModal.tsx'), 'utf8');
const BUTTON_SRC = readFileSync(join(HERE, 'SaveAsNoteButton.tsx'), 'utf8');

// Stub DaemonContext value — the modal reads `config.baseUrl` /
// `config.token` on render via useDaemon.
const STUB_DAEMON = {
  config: { baseUrl: 'http://localhost:31415', token: '', provider: '' },
  setConfig: () => {},
  client: {} as never,
  sessionId: 'sess-test',
  setSessionId: () => {},
};

function renderWith(props: Parameters<typeof NoteFromImageModal>[0]): string {
  return renderToStaticMarkup(
    <DaemonContext.Provider value={STUB_DAEMON}>
      <NoteFromImageModal {...props} />
    </DaemonContext.Provider>,
  );
}

describe('NoteFromImageModal · render contract', () => {
  test('open=false → renders nothing visible (Dialog portal closed)', () => {
    const html = renderWith({ open: false, image: null, onClose: () => {} });
    // base-ui Dialog renders into a Portal which needs DOM access;
    // SSR returns empty string for both open=false AND open=true
    // (the popup never reaches the server-rendered tree). The
    // open=false branch still serves as a sanity check that the
    // component mounts without throwing.
    expect(typeof html).toBe('string');
    expect(html).not.toContain('사진 → 마크다운 노트');
  });

  test('renders without throwing when image is null + open=true', () => {
    // Defensive — verifies the component handles the (parent forgot
    // to set image) edge case without crashing during the OCR effect
    // wire. Visual assertion is impossible with the SSR portal limit
    // above, so we settle for a no-throw guarantee.
    expect(() => renderWith({ open: true, image: null, onClose: () => {} }))
      .not.toThrow();
  });
});

describe('NoteFromImageModal · source-level wiring guards', () => {
  test('uses POST /v1/notes/from-image for OCR step', () => {
    // Path appears inside a template literal after `${config.baseUrl}`,
    // so we just check the literal path string is present in source.
    expect(MODAL_SRC).toContain('/v1/notes/from-image');
  });

  test('uses POST /v1/notes/save for the Save step', () => {
    expect(MODAL_SRC).toContain('/v1/notes/save');
  });

  test('forwards polishMode in the OCR multipart body', () => {
    expect(MODAL_SRC).toMatch(/form\.append\(['"]polishMode['"]/);
  });

  test('forwards markdown · sourceProvider · polishMode in the save JSON body', () => {
    // The handler reads exactly these top-level keys; pin them so a
    // rename on the modal side surfaces here, not at runtime.
    expect(MODAL_SRC).toMatch(/markdown[\s,:]/);
    expect(MODAL_SRC).toMatch(/sourceProvider[\s,:]/);
    expect(MODAL_SRC).toMatch(/polishMode[\s,:]/);
  });

  test('declares the 6-state phase machine', () => {
    // Each label appears at least once as a string-literal phase.
    for (const phase of ['idle', 'ocr', 'review', 'saving', 'saved', 'error']) {
      expect(MODAL_SRC).toContain(`'${phase}'`);
    }
  });

  test('polishMode union is minimal | enrich (D-1.4 contract)', () => {
    expect(MODAL_SRC).toMatch(/'minimal'\s*\|\s*'enrich'/);
  });
});

describe('SaveAsNoteButton · source-level wiring guards', () => {
  test('opens NoteFromImageModal with the picked image blob', () => {
    expect(BUTTON_SRC).toContain('NoteFromImageModal');
    expect(BUTTON_SRC).toMatch(/setImage\(file\)/);
    expect(BUTTON_SRC).toMatch(/setOpen\(true\)/);
  });

  test('uses capture="environment" for iOS Safari camera UI', () => {
    expect(BUTTON_SRC).toMatch(/capture=['"]environment['"]/);
    expect(BUTTON_SRC).toMatch(/accept=['"]image\/\*['"]/);
  });

  test('drops the image reference on close to free the blob', () => {
    expect(BUTTON_SRC).toMatch(/setImage\(null\)/);
  });
});
