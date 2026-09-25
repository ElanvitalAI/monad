'use client';

// PWA `/setup` Phase 1 (2026-05-19) — 공통 API key 입력 필드.
//
// LLM provider 별 prefix / 길이 검증 + show/hide toggle + paste 즉시 trim.
// `/setup` 의 LLM step 외에도 향후 settings card 들이 동일 패턴 재사용하도록
// 분리. show/hide 토글은 default hide (보안 + 어깨너머 방어).

import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ApiKeyFieldValidation {
  /** Expected prefix (e.g., 'sk-ant-' for Anthropic). Empty string skips
   *  prefix check. Case-sensitive. */
  prefix?: string;
  /** Min length AFTER trim. Defaults to 8 — any LLM API key 가 길어도 8자
   *  미만이면 paste 오류. */
  minLength?: number;
}

export interface ApiKeyFieldProps {
  /** Field label rendered above the input (e.g. "Anthropic API key"). */
  label: string;
  /** Controlled value. */
  value: string;
  /** Trimmed value emit. */
  onChange: (value: string) => void;
  /** Provider-specific validation rules. Optional — when omitted, only
   *  the default minLength check applies. */
  validation?: ApiKeyFieldValidation;
  /** Disable interaction (e.g. while submitting). */
  disabled?: boolean;
  /** Override placeholder. Default = label 의 뒷부분 (e.g. "sk-ant-..."). */
  placeholder?: string;
  /** Optional id for test queries + a11y label-input pairing. */
  id?: string;
}

const DEFAULT_MIN_LENGTH = 8;

interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function validateApiKey(
  value: string,
  validation: ApiKeyFieldValidation = {},
): ValidationResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'required' };
  }
  const minLen = validation.minLength ?? DEFAULT_MIN_LENGTH;
  if (trimmed.length < minLen) {
    return { ok: false, message: `at least ${minLen} characters` };
  }
  if (validation.prefix && validation.prefix.length > 0) {
    if (!trimmed.startsWith(validation.prefix)) {
      return { ok: false, message: `must start with "${validation.prefix}"` };
    }
  }
  return { ok: true };
}

/** Redacted preview for compact display (e.g. settings card "current key"
 *  hint). NEVER echoes more than first 4 + last 4 chars. */
export function redactApiKey(value: string): string {
  const v = value.trim();
  if (v.length === 0) return '';
  if (v.length <= 8) return '•'.repeat(v.length);
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function ApiKeyField({
  label,
  value,
  onChange,
  validation,
  disabled,
  placeholder,
  id,
}: ApiKeyFieldProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? `api-key-${label.toLowerCase().replace(/\s+/g, '-')}`;

  const result = useMemo(() => validateApiKey(value, validation), [value, validation]);
  const showError = value.length > 0 && !result.ok;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Trim leading/trailing whitespace on every keystroke — paste 시
      // accidental whitespace 가 가장 흔한 에러 원인.
      onChange(e.target.value.replace(/^\s+|\s+$/g, ''));
    },
    [onChange],
  );

  const toggle = useCallback(() => setVisible((v) => !v), []);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-medium text-foreground/80"
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder ?? `Paste your ${label}`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={showError}
          aria-describedby={showError ? `${inputId}-error` : undefined}
          className={cn(
            'font-mono text-xs',
            showError && 'border-destructive',
          )}
          data-testid="api-key-input"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggle}
          disabled={disabled}
          aria-label={visible ? 'Hide API key' : 'Show API key'}
          data-testid="api-key-toggle"
        >
          {visible ? 'Hide' : 'Show'}
        </Button>
      </div>
      {showError && result.message ? (
        <p
          id={`${inputId}-error`}
          className="text-xs text-destructive"
          data-testid="api-key-error"
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
