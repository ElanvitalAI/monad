'use client';

// Phase 3 (PWA chat ↔ voice 일원화 · 2026-05-07) — voice 활성 시
// ChatHistory 영역 위에 fade-in overlay. 사용자 결정 Q3=C2 — backdrop-
// blur + 큰 voice card 가 기존 /VoicePanel 미감을 보존하면서 chat 흐름
// 안에 머무르게 한다.
//
// CSS-only transition (framer-motion 의존성 회피 · autopilot rule).
// `data-monad-voice-overlay` selector + `aria-hidden` 으로 외부에서
// 시각/접근성 검증 가능.

import { Mic, MicOff, Loader2, AlertCircle, Volume2, VolumeX, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoicePhase } from '@/voice/use-voice-controller';

export interface VoiceOverlayProps {
  /** voice controller 의 active flag — false 면 즉시 fade-out + pointer
   *  block 해제. true 일 때 phase 별 visual 으로 분기. */
  active: boolean;
  phase: VoicePhase;
  /** STT WS / mic permission 등 transport 오류 메시지. 비어있으면
   *  아무것도 렌더하지 않음. */
  errorMsg: string | null;
  /** mic toggle 콜백 — overlay 안 큰 mic 버튼 + 상단 X 버튼 모두 호출. */
  onToggle: () => void;
  /** Phase 5 — TTS mute toggle. assistant 응답 음성 출력 ON/OFF 를
   *  voice card 안에서 직접 토글. 미지원 환경 (`ttsSupported=false`)
   *  에서는 버튼 자체 미렌더 (mic 만 작동 · speech synthesis 0). */
  ttsSupported?: boolean;
  ttsMuted?: boolean;
  onTtsToggle?: () => void;
  /** BI-1 manual barge-in (Phase D · 2026-05-09) — `phase==='speaking'`
   *  일 때 큰 mic 버튼이 "끼어들기" 액션으로 변환. 클릭 시 controller
   *  의 interrupt() 호출 → 로컬 playback cancel + UPSTREAM_INTERRUPT
   *  fire. 미지원 시 omit (overlay 는 기존 mic-toggle 만 표시). */
  onInterrupt?: () => void;
}

const PHASE_HEADLINE: Record<VoicePhase, string> = {
  idle: '음성 대기',
  connecting: '데몬 연결 중…',
  listening: '듣는 중',
  processing: '생각 중…',
  speaking: '말하는 중',
  error: '음성 오류',
};

const PHASE_HINT: Record<VoicePhase, string> = {
  idle: '마이크를 켜서 대화를 시작하세요.',
  connecting: '잠시만 기다려주세요.',
  listening: '문장이 끝나면 자동으로 전송됩니다.',
  processing: '서버가 응답을 생성하는 중입니다.',
  speaking: '음성 응답을 재생하는 중입니다.',
  error: '아래 메시지를 확인하고 다시 시도하세요.',
};

const PHASE_DOT: Record<VoicePhase, string> = {
  idle: 'bg-slate-400',
  connecting: 'bg-amber-500',
  listening: 'bg-emerald-500',
  processing: 'bg-sky-500',
  speaking: 'bg-fuchsia-500',
  error: 'bg-rose-600',
};

export function VoiceOverlay({
  active,
  phase,
  errorMsg,
  onToggle,
  ttsSupported = false,
  ttsMuted = false,
  onTtsToggle,
  onInterrupt,
}: VoiceOverlayProps) {
  // BI-1 — when speaking + interrupt callback wired, the big circular
  // button switches into "끼어들기" mode. Clicking it does NOT close the
  // mic (vs onToggle) — instead it cancels playback + fires
  // UPSTREAM_INTERRUPT so the agent stops talking and the next utterance
  // starts fresh. Falls back to mic-toggle behavior outside speaking.
  const showInterrupt = phase === 'speaking' && typeof onInterrupt === 'function';
  // Listening / processing / speaking / error 상태 모두 사용자에게
  // overlay 가 의미 있음. idle (active=false) 은 표시 안 함.
  // active 가 false 가 되면 즉시 fade-out 시작 + 300ms 뒤 pointer 차단.
  const visible = active;

  return (
    <div
      data-monad-voice-overlay
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300',
        visible ? 'pointer-events-auto opacity-100' : 'opacity-0',
      )}
    >
      {/* Backdrop — backdrop-blur 가 ChatHistory 텍스트 위로 살짝 흐림.
          bg-background/60 으로 다크/라이트 테마 모두에서 가독성 확보. */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />

      {/* Voice card — relative 라 backdrop 위로 떠 있음. 기존 /VoicePanel
          의 외형 (rounded card · phase dot · 큰 mic 버튼) 재현. */}
      <div className="relative mx-4 flex w-full max-w-sm flex-col items-center gap-5 rounded-xl border border-border bg-card px-6 py-7 text-center shadow-xl">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              PHASE_DOT[phase],
              (phase === 'listening' || phase === 'speaking' || phase === 'connecting') && 'animate-pulse',
            )}
            aria-hidden
          />
          <span className="font-medium tracking-wide">{PHASE_HEADLINE[phase]}</span>
        </div>

        <p className="text-xs text-muted-foreground">{PHASE_HINT[phase]}</p>

        <button
          type="button"
          onClick={showInterrupt ? onInterrupt : onToggle}
          data-monad-action={showInterrupt ? 'voice-overlay-interrupt' : 'voice-overlay-toggle'}
          className={cn(
            'inline-flex h-16 w-16 items-center justify-center rounded-full text-white transition-colors',
            showInterrupt
              ? 'bg-amber-500 hover:bg-amber-400 animate-pulse'
              : phase === 'connecting' || phase === 'processing'
                ? 'bg-sky-500 hover:bg-sky-400'
                : phase === 'error'
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-rose-500 hover:bg-rose-400',
          )}
          aria-label={showInterrupt ? '끼어들기' : '마이크 끄기'}
        >
          {showInterrupt ? (
            <Hand className="h-7 w-7" />
          ) : phase === 'connecting' || phase === 'processing' ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : phase === 'error' ? (
            <AlertCircle className="h-7 w-7" />
          ) : (
            <Mic className="h-7 w-7" />
          )}
        </button>

        {errorMsg && (
          <p className="max-w-xs text-xs text-rose-500">{errorMsg}</p>
        )}

        <div className="flex items-center gap-4">
          {/* Phase 5 — TTS mute toggle. browser 가 speechSynthesis 미지원
              이면 button 자체 안 보임 (사용자에게 잠긴 토글 노출 회피). */}
          {ttsSupported && onTtsToggle && (
            <button
              type="button"
              onClick={onTtsToggle}
              data-monad-action="voice-overlay-tts-toggle"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label={ttsMuted ? '음성 응답 켜기' : '음성 응답 끄기'}
              aria-pressed={!ttsMuted}
            >
              {ttsMuted ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              <span>{ttsMuted ? '음성 응답 OFF' : '음성 응답 ON'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="음성 닫고 텍스트로 돌아가기"
          >
            <MicOff className="h-3.5 w-3.5" />
            <span>음성 끄기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
