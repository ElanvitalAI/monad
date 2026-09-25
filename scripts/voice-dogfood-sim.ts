// PR-S1V.4-wiring · Headless voice dogfood simulation.
//
// SSH-friendly verification of the wiring chain WITHOUT mic / audio
// capture / OpenAI Whisper API. Replays a curated set of transcript
// scenarios through the actual `voice-input-bridge` against a fake
// live-session registry that mirrors a 4-pane room (codex / claude-code
// / gemini / monad). The resolveSession + submitToSession logic is
// transcribed from `dashboard/index.ts` so the script proves the wiring
// chain a real Ctrl+Shift+V → Space hold → STT round-trip would take.
//
// Run: bun run scripts/voice-dogfood-sim.ts
//
// What this verifies (real-fidelity, no mocks except audio + STT):
//   1. routeVoiceTranscript prefix detection (Korean + English).
//   2. BRAND_ALIASES alias-normalized lookup — `claude` voice brand
//      matches `claude-code` launch brand.
//   3. resolveSession focused fallback chain (no brand → focused
//      conversation → focused VW pane → null).
//   4. submitToSession transport split — PTY embodied target gets
//      newline-appended `entry.session.send`; ACP target gets the
//      router echo + clientSessionSend pair.
//   5. onSendError surface — submit rejection routes to the host
//      callback without throwing into voice-mode.
//
// What this does NOT verify (out of scope · cover via real dogfood):
//   - sox/arecord audio capture (PR-S1V.1 dogfood already covers · 91 KB / 2.8 s).
//   - OpenAI Whisper transcription accuracy (PR-S1V.2 dogfood already
//     covers · "MBC 뉴스 이덕영입니다." Korean STT verified).
//   - kitty `>3u` keyboard protocol (terminal-dependent · real dogfood).
//   - Dashboard render path / status bar paint.
//
// Backlog (내부 문서 `BACKLOG-voice-simulation-framework-2026-04-29`):
//   This is a TEMPORARY in-place duplication of dashboard wiring. The
//   resolveSession + submitToSession factories should be extracted from
//   `dashboard/index.ts` so this script + production share one source of
//   truth (drift risk otherwise).

import { createVoiceInputBridge, type SessionResolution } from '../src/voice/voice-input-bridge.js';
import type { STTProvider, STTResult } from '../src/voice/stt-provider.js';
import type { VoiceBrand } from '../src/voice/voice-prefix-router.js';

// ── Fake 4-pane room registry ──────────────────────────────────────
//
// Mirrors `LiveSessionEntry` from `agent/spawn-embodied-agent-in-vw.ts`.
// `transport: 'pty'` simulates an embodied PTY session (codex / claude /
// gemini); `transport: 'acp'` simulates an ACP live pane.

interface FakeLiveSession {
  id: string;
  launchBrand: string;       // e.g. 'claude-code' (real launch brand)
  transport: 'pty' | 'acp';
  paneId: string;
  windowId: number;
}

const FAKE_LIVE_SESSIONS: FakeLiveSession[] = [
  { id: 'sess-codex',  launchBrand: 'codex',       transport: 'pty', paneId: 'pane-1', windowId: 1 },
  { id: 'sess-claude', launchBrand: 'claude-code', transport: 'pty', paneId: 'pane-2', windowId: 1 },
  { id: 'sess-gemini', launchBrand: 'gemini',      transport: 'pty', paneId: 'pane-3', windowId: 1 },
  { id: 'sess-acp-1',  launchBrand: 'monad',       transport: 'acp', paneId: 'pane-4', windowId: 1 },
];

// Focused conversation popup id — simulates dashboard's
// `conversationPopupHost.snapshot().focusedSessionId`.
let focusedConversationId: string | null = 'sess-claude';

// ── DUPLICATED FROM dashboard/index.ts (drift risk · backlog #1) ──
//
// Identical logic to the production wiring so the script proves the
// real chain. Extract to a shared factory in a follow-up.

const BRAND_ALIASES: Readonly<Record<VoiceBrand, readonly string[]>> = {
  claude: ['claude-code', 'claude'],
  codex:  ['codex'],
  gemini: ['gemini'],
  monad:  ['monad', 'monad-child'],
};

function findLiveById(id: string): FakeLiveSession | undefined {
  return FAKE_LIVE_SESSIONS.find(s => s.id === id);
}

function resolveSession(brand: VoiceBrand | null): SessionResolution | null {
  if (brand) {
    const candidates = BRAND_ALIASES[brand];
    const match = FAKE_LIVE_SESSIONS.find(entry =>
      candidates.some(c => entry.launchBrand === c || entry.launchBrand.startsWith(c)),
    );
    return match ? { sessionId: match.id } : null;
  }
  // Fallback (a) — focused conversation popup.
  if (focusedConversationId) {
    const f = findLiveById(focusedConversationId);
    if (f) return { sessionId: f.id };
  }
  // Fallback (c) — focused VW pane is intentionally not modelled here
  // (the conversation popup state is the closer parallel). When both
  // miss the bridge drops the transcript with reason='no-stream'.
  return null;
}

interface SendRecord {
  sessionId: string;
  payload: string;
  transport: 'pty' | 'acp';
  routerEchoed: boolean;
}
const sendLog: SendRecord[] = [];

async function submitToSession(sessionId: string, text: string): Promise<void> {
  const entry = findLiveById(sessionId);
  if (!entry) throw new Error(`unknown session: ${sessionId}`);
  if (entry.transport === 'pty') {
    const submitText = text.endsWith('\n') ? text : text + '\n';
    sendLog.push({
      sessionId,
      payload: submitText,
      transport: 'pty',
      routerEchoed: false,
    });
    return;
  }
  // ACP: optimistic echo via router, then clientSessionSend.
  sendLog.push({
    sessionId,
    payload: text,
    transport: 'acp',
    routerEchoed: true,
  });
}

// ── Scenarios ────────────────────────────────────────────────────

interface Scenario {
  label: string;
  transcript: string;
  expectBrand: VoiceBrand | null | 'rejected';   // 'rejected' = should drop
  expectSessionId: string | null;
  expectStripped: string;
  expectTransport?: 'pty' | 'acp';
  expectRouterEcho?: boolean;
  expectNewlineAppended?: boolean;               // PTY only
}

const SCENARIOS: Scenario[] = [
  {
    label: 'Korean — 코덱스에게 (PTY)',
    transcript: '코덱스에게 react 만들어줘',
    expectBrand: 'codex',
    expectSessionId: 'sess-codex',
    expectStripped: 'react 만들어줘',
    expectTransport: 'pty',
    expectRouterEcho: false,
    expectNewlineAppended: true,
  },
  {
    label: 'Korean — 클로드에게 (claude alias → claude-code launch brand · PTY)',
    transcript: '클로드에게 plan 짜줘',
    expectBrand: 'claude',
    expectSessionId: 'sess-claude',
    expectStripped: 'plan 짜줘',
    expectTransport: 'pty',
    expectRouterEcho: false,
    expectNewlineAppended: true,
  },
  {
    label: 'Korean — 제미니에게 (PTY)',
    transcript: '제미니에게 분석해줘',
    expectBrand: 'gemini',
    expectSessionId: 'sess-gemini',
    expectStripped: '분석해줘',
    expectTransport: 'pty',
    expectRouterEcho: false,
  },
  {
    label: 'Korean — 모나드에게 (ACP transport)',
    transcript: '모나드에게 status report',
    expectBrand: 'monad',
    expectSessionId: 'sess-acp-1',
    expectStripped: 'status report',
    expectTransport: 'acp',
    expectRouterEcho: true,
    expectNewlineAppended: false,
  },
  {
    label: 'English — to claude, …',
    transcript: 'to claude, review please',
    expectBrand: 'claude',
    expectSessionId: 'sess-claude',
    expectStripped: 'review please',
    expectTransport: 'pty',
    expectRouterEcho: false,
  },
  {
    label: 'English — codex, …',
    transcript: 'codex, write a unit test',
    expectBrand: 'codex',
    expectSessionId: 'sess-codex',
    expectStripped: 'write a unit test',
    expectTransport: 'pty',
    expectRouterEcho: false,
  },
  {
    label: 'No prefix → focused fallback (claude-code)',
    transcript: 'plan 짜줘',
    expectBrand: null,
    expectSessionId: 'sess-claude',           // focusedConversationId
    expectStripped: 'plan 짜줘',
    expectTransport: 'pty',
    expectRouterEcho: false,
  },
  {
    label: 'Bare brand mention without postposition → focused fallback',
    transcript: '코덱스 결과 보여줘',
    expectBrand: null,
    expectSessionId: 'sess-claude',
    expectStripped: '코덱스 결과 보여줘',
    expectTransport: 'pty',
    expectRouterEcho: false,
  },
  {
    label: 'Empty transcript → drop',
    transcript: '   ',
    expectBrand: 'rejected',
    expectSessionId: null,
    expectStripped: '',
  },
  {
    label: 'No focused fallback target → reason=no-stream',
    transcript: 'plan 짜줘',
    expectBrand: 'rejected',
    expectSessionId: null,
    expectStripped: 'plan 짜줘',
  },
];

// ── Stub STT provider — never called because we feed transcript text
// directly via `injectTranscript`. The provider field is required by
// the bridge constructor.

function fakeSTT(): STTProvider {
  return {
    id: 'openai-whisper',
    transcribeBatch: async (_pcm: Buffer): Promise<STTResult> => ({ text: '' }),
  };
}

// ── Pretty printer ───────────────────────────────────────────────

const ICON = { pass: '✓', fail: '✗', skip: '·' };

function check(label: string, ok: boolean, detail?: string): boolean {
  const icon = ok ? ICON.pass : ICON.fail;
  console.log(`    ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// ── Runner ───────────────────────────────────────────────────────

async function runScenario(
  bridge: ReturnType<typeof createVoiceInputBridge>,
  s: Scenario,
  index: number,
): Promise<boolean> {
  console.log(`\n[${index + 1}] ${s.label}`);
  console.log(`    input:    "${s.transcript}"`);

  // Last scenario simulates focused-fallback null — clear the focused id.
  const restore = focusedConversationId;
  if (s.expectBrand === 'rejected' && s.expectStripped !== '') {
    focusedConversationId = null;
  }

  const before = sendLog.length;
  const result = await bridge.injectTranscript(s.transcript);
  const after = sendLog.slice(before);

  // Restore focus.
  focusedConversationId = restore;

  let allPassed = true;

  if (s.expectBrand === 'rejected') {
    allPassed = check(
      'injected=false (drop)',
      !result.injected,
      `reason=${result.reason}`,
    ) && allPassed;
    allPassed = check(
      'no submit recorded',
      after.length === 0,
    ) && allPassed;
    return allPassed;
  }

  allPassed = check('routing.brand', result.routing.brand === s.expectBrand,
    `got=${result.routing.brand} want=${s.expectBrand}`) && allPassed;
  allPassed = check('routing.text (stripped)', result.routing.text === s.expectStripped,
    `got="${result.routing.text}" want="${s.expectStripped}"`) && allPassed;
  allPassed = check('sessionId', result.sessionId === s.expectSessionId,
    `got=${result.sessionId} want=${s.expectSessionId}`) && allPassed;
  allPassed = check('injected=true', result.injected === true) && allPassed;

  if (s.expectTransport && after.length === 1) {
    const rec = after[0]!;
    allPassed = check('transport', rec.transport === s.expectTransport,
      `got=${rec.transport} want=${s.expectTransport}`) && allPassed;
    if (s.expectRouterEcho !== undefined) {
      allPassed = check('routerEchoed', rec.routerEchoed === s.expectRouterEcho,
        `got=${rec.routerEchoed} want=${s.expectRouterEcho}`) && allPassed;
    }
    if (s.expectNewlineAppended !== undefined) {
      const hasNl = rec.payload.endsWith('\n');
      allPassed = check('newline appended (PTY)',
        hasNl === s.expectNewlineAppended,
        `got=${hasNl} want=${s.expectNewlineAppended}`) && allPassed;
    }
  } else if (s.expectTransport) {
    allPassed = check('exactly one submit recorded', false,
      `got ${after.length} recorded`) && allPassed;
  }

  return allPassed;
}

async function runFailureCase(): Promise<boolean> {
  console.log(`\n[F] Send failure → onSendError surface`);
  const errors: string[] = [];
  const bridge = createVoiceInputBridge({
    sttProvider: fakeSTT(),
    resolveSession,
    submitToSession: async () => { throw new Error('simulated network drop'); },
    onSendError: (err) => errors.push(err.message),
  });
  const result = await bridge.injectTranscript('to claude, ping');
  let ok = check('injected=true (user block already echoed)', result.injected === true);
  ok = check('result.sendError set', result.sendError instanceof Error,
    result.sendError?.message) && ok;
  ok = check('onSendError fired exactly once', errors.length === 1,
    `got ${errors.length}`) && ok;
  ok = check('error message preserved',
    errors[0] === 'simulated network drop',
    `got="${errors[0]}"`) && ok;
  return ok;
}

async function main(): Promise<number> {
  console.log('━━━ PR-S1V.4-wiring · headless dogfood simulation ━━━');
  console.log(`Live sessions:`);
  for (const s of FAKE_LIVE_SESSIONS) {
    console.log(`  ${s.id}  brand=${s.launchBrand.padEnd(12)}  transport=${s.transport}`);
  }
  console.log(`Focused conversation: ${focusedConversationId}`);

  const bridge = createVoiceInputBridge({
    sttProvider: fakeSTT(),
    resolveSession,
    submitToSession,
  });

  let passed = 0;
  let failed = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    const ok = await runScenario(bridge, SCENARIOS[i]!, i);
    ok ? passed++ : failed++;
  }
  const failureOk = await runFailureCase();
  failureOk ? passed++ : failed++;

  console.log('\n━━━ Summary ━━━');
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  console.log(`  total:  ${passed + failed}`);
  return failed === 0 ? 0 : 1;
}

main().then((rc) => process.exit(rc)).catch((err) => {
  console.error('sim crashed:', err);
  process.exit(2);
});
