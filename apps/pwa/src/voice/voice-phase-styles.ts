// Shared voice phase → tailwind color + label maps. Used by ChatLayout
// (`/chat`) and TerminalPanel (`/term`) so both surfaces render the
// same indicator colors / labels without drifting.
//
// Single source of truth — when adding a new VoicePhase or changing
// a label, update here and both routes pick it up.

import type { VoicePhase } from './use-voice-controller';

export const VOICE_DOT_COLOR: Record<VoicePhase, string> = {
  idle: 'bg-slate-400',
  connecting: 'bg-amber-500',
  listening: 'bg-emerald-500',
  processing: 'bg-sky-500',
  speaking: 'bg-fuchsia-500',
  error: 'bg-rose-600',
};

export const VOICE_PHASE_LABEL: Record<VoicePhase, string> = {
  idle: '음성 대기',
  connecting: '연결 중…',
  listening: '듣는 중',
  processing: '생각 중',
  speaking: '말하는 중',
  error: '음성 오류',
};
