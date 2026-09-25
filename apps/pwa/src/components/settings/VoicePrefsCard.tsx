'use client';

// C2 (PWA pre-iOS round 2 follow-up · 2026-05-11) — Voice prefs Settings card.
//
// Single slider for `speakingThresholdMultiplier` (BI-2 RMS detector
// 의 TTS playback ducking 강도). Default `2.0` 이 quiet 환경에서 적합;
// 자기-에코 false-fire 가 자주 발생하면 사용자가 3.0+ 로 raise, AEC 가
// 강한 환경에서는 1.5 로 낮춰 cut-in latency 감소.
//
// 변경 즉시 effective 하지 않음 — useVoiceController 가 hook init 시 한
// 번만 detector 를 만들기 때문에 (rmsDetectorRef ?? createRmsActivityDetector(...)).
// 사용자가 voice 를 toggle off → on 하거나 페이지 refresh 하면 새 prefs 가
// 적용. 카드는 이를 hint text 로 명시.

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DEFAULT_VOICE_PREFS,
  SPEAKING_MULTIPLIER_MIN,
  SPEAKING_MULTIPLIER_MAX,
  loadVoicePrefs,
  saveVoicePrefs,
  resetVoicePrefs,
  type VoicePrefs,
} from '@/lib/voice-prefs';
import { debugLog } from '@/lib/debug';

const SLIDER_STEP = 0.1;

function multiplierLabel(value: number): string {
  // Compact 1-decimal label so `2.0` reads cleanly while `1.7` still
  // renders precisely. 0.1 step matches the slider granularity.
  return `${value.toFixed(1)}×`;
}

function multiplierHint(value: number): string {
  if (value <= 1.2) return '거의 ducking 없음 — 자기-에코 false-fire 가능';
  if (value <= 1.7) return '약한 ducking — 강한 AEC 환경 + 빠른 cut-in';
  if (value <= 2.5) return '기본값 — 대부분 환경에서 균형';
  if (value <= 3.5) return '강한 ducking — 시끄러운 환경 / 민감한 마이크';
  return '매우 강한 ducking — 자기-에코가 심한 환경';
}

export function VoicePrefsCard(): React.ReactNode {
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);

  useEffect(() => {
    setPrefs(loadVoicePrefs());
  }, []);

  const update = (patch: Partial<VoicePrefs>): void => {
    const next = saveVoicePrefs(patch);
    setPrefs(next);
    debugLog('settings.voice-prefs.update', patch);
  };

  const onReset = (): void => {
    setPrefs(resetVoicePrefs());
    debugLog('settings.voice-prefs.reset');
  };

  const isDefault = prefs.speakingThresholdMultiplier === DEFAULT_VOICE_PREFS.speakingThresholdMultiplier;

  return (
    <section
      data-testid="voice-prefs-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">🎙️ Voice barge-in 튜닝</h3>
        <p className="text-xs text-muted-foreground">
          BI-2 ducking 강도 — TTS 재생 중 자기-에코 false-fire 를 막는 RMS multiplier.
          변경은 voice toggle off → on 또는 새로고침 시 적용.
        </p>
      </header>

      <div className="space-y-3">
        <div className="rounded-md border border-input bg-background px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">speaking threshold multiplier</span>
            <span
              className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]"
              data-testid="voice-prefs-multiplier-value"
            >
              {multiplierLabel(prefs.speakingThresholdMultiplier)}
            </span>
          </div>
          <input
            type="range"
            min={SPEAKING_MULTIPLIER_MIN}
            max={SPEAKING_MULTIPLIER_MAX}
            step={SLIDER_STEP}
            value={prefs.speakingThresholdMultiplier}
            onChange={(e) => update({ speakingThresholdMultiplier: Number(e.target.value) })}
            data-testid="voice-prefs-multiplier-slider"
            aria-label="Speaking threshold multiplier"
            aria-valuemin={SPEAKING_MULTIPLIER_MIN}
            aria-valuemax={SPEAKING_MULTIPLIER_MAX}
            aria-valuenow={prefs.speakingThresholdMultiplier}
            className="w-full"
          />
          <p
            className="mt-1 text-[11px] text-muted-foreground"
            data-testid="voice-prefs-hint"
          >
            {multiplierHint(prefs.speakingThresholdMultiplier)}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={isDefault}
          className="text-xs text-muted-foreground"
          data-testid="voice-prefs-reset"
        >
          기본값으로 리셋 ({DEFAULT_VOICE_PREFS.speakingThresholdMultiplier.toFixed(1)}×)
        </Button>
      </div>
    </section>
  );
}
