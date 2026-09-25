'use client';

// R-OCR follow-up Phase B (2026-05-09) — Settings card for OCR provider prefs.
//
// Two toggles:
//   - LLM 비전 default — on/off for `useLlmVision` initial state in
//     NoteFromImageModal.
//   - 손글씨 default — on/off for `preferHandwriting` initial state.
//
// Both back the multipart `strengths` field on `/v1/notes/from-image`
// so the registry's score boost picks the right provider per the
// user's habitual workflow without requiring a per-capture toggle flip.

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  loadOcrPrefs,
  saveOcrPrefs,
  resetOcrPrefs,
  type OcrPrefs,
} from '@/lib/ocr-prefs';
import { debugLog } from '@/lib/debug';

export function OcrPrefsCard(): React.ReactNode {
  // SSR-safe initial — loadOcrPrefs returns defaults outside browser.
  // Mount effect re-syncs from localStorage so the rendered toggles
  // reflect the persisted values (the SSR pass + first-CSR mount
  // diverge intentionally — same pattern as DaemonProvider).
  const [prefs, setPrefs] = useState<OcrPrefs>(loadOcrPrefs);

  useEffect(() => {
    setPrefs(loadOcrPrefs());
  }, []);

  const update = (patch: Partial<OcrPrefs>): void => {
    const next = saveOcrPrefs(patch);
    setPrefs(next);
    debugLog('settings.ocr-prefs.update', patch);
  };

  const onReset = (): void => {
    setPrefs(resetOcrPrefs());
    debugLog('settings.ocr-prefs.reset');
  };

  return (
    <section
      data-testid="ocr-prefs-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">📷 OCR 기본 설정</h3>
        <p className="text-xs text-muted-foreground">
          사진 → 노트 모달의 초기 토글 상태. 매번 같은 옵션을 켜고 있다면 default 로 저장.
        </p>
      </header>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2 text-xs">
          <span className="flex items-center gap-2">
            <span>LLM 비전 default</span>
            <span className="text-muted-foreground">
              · 더 정확하지만 느림 + 비쌈
            </span>
          </span>
          <input
            type="checkbox"
            data-testid="ocr-prefs-llm-vision"
            checked={prefs.defaultUseLlmVision}
            onChange={(e) => update({ defaultUseLlmVision: e.target.checked })}
            aria-label="LLM 비전 default"
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2 text-xs">
          <span className="flex items-center gap-2">
            <span>손글씨 default</span>
            <span className="text-muted-foreground">
              · handwriting strength 자동 추가
            </span>
          </span>
          <input
            type="checkbox"
            data-testid="ocr-prefs-handwriting"
            checked={prefs.defaultPreferHandwriting}
            onChange={(e) => update({ defaultPreferHandwriting: e.target.checked })}
            aria-label="손글씨 default"
          />
        </label>
      </div>

      <div className="mt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="text-xs text-muted-foreground"
          data-testid="ocr-prefs-reset"
        >
          기본값으로 리셋
        </Button>
      </div>
    </section>
  );
}
