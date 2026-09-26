import type { Key } from '../tui.js';
import { debug } from '../debug/log.js';
import type { TextInputGlobalAction } from './index.js';

export interface MatchTextInputGlobalActionOptions {
  includeCopyLastBlock?: boolean;
  allowSpawnTerminalModal?: boolean;
  allowToggleLogZoom?: boolean;
}

// Korean Hangul Compatibility Jamo whose codepoint encodes the
// Shift modifier (e.g. 'ㅆ' = Shift+'ㅅ' on the standard 2-bul layout).
// ghostty / kitty CSI-u may or may not also set the shift bit when the
// shift is "consumed" by the codepoint, so matchers that gate on
// `key.shift` would miss these. When matching Ctrl+Shift+<latin>
// chords we accept the corresponding Korean shifted form even if
// `key.shift === false`.
const KOREAN_SHIFTED_T = 'ㅆ';  // Shift+T in 2-bul → ㅆ
const KOREAN_SHIFTED_L = 'ㅣ';  // L position is not shifted in 2-bul; included for symmetry but no shifted variant
const KOREAN_SHIFTED_Y = 'ㅛ';  // ditto for Y
const KOREAN_SHIFTED_Z = 'ㅋ';  // Z position has no shifted variant in 2-bul; ㅋ is the only form

export function matchTextInputGlobalAction(
  key: Key,
  opts: MatchTextInputGlobalActionOptions = {},
): TextInputGlobalAction | null {
  if (key.ctrl && (key.name === 'g' || key.name === 'ㅎ')) {
    return { kind: 'goto-log' };
  }

  if (key.ctrl && (key.name === 'up' || key.name === 'down' || key.name === '0')) {
    if (key.name === 'up') return { kind: 'resize-log', delta: key.shift ? +5 : +1 };
    if (key.name === 'down') return { kind: 'resize-log', delta: key.shift ? -5 : -1 };
    return { kind: 'resize-log', delta: 0, reset: true };
  }

  if (opts.includeCopyLastBlock
      && key.ctrl
      && (key.name === 'y' || key.name === 'Y' || key.name === KOREAN_SHIFTED_Y)) {
    return { kind: 'copy-last-block' };
  }

  if (key.ctrl && key.shift
      && (key.name === 'l' || key.name === 'L' || key.name === KOREAN_SHIFTED_L)) {
    // ★ 'ㅣ' ctrl-only 수용 제거(2026-07-12) — 한글 IME 의 Ctrl+L(=Ctrl+ㅣ)이
    // copy-log-pane 으로 새서 영문/한글 IME 에 따라 다른 동작이 되던 충돌.
    // copy 는 shift 비트가 명시된 경우만(kitty CSI-u 는 ㅣ+shift 로 보고).
    return { kind: 'copy-log-pane' };
  }

  // Ctrl+L(shift 없음) — 화면 클리어 + 강제 리페인트(대화 보존). codex
  // clear_terminal · claude-code app:redraw 관례. 한글 IME('ㅣ')도 동일.
  if (key.ctrl && !key.shift
      && (key.name === 'l' || key.name === 'L' || key.name === KOREAN_SHIFTED_L)) {
    return { kind: 'force-redraw' };
  }

  if (opts.allowSpawnTerminalModal !== false
      && (
        (key.ctrl && (
          (key.shift && (key.name === 't' || key.name === 'T' || key.name === 'ㅅ'))
          // 'ㅆ' = Shift+'ㅅ' codepoint — shift may be implicit. ghostty
          // captures the keyboard via macOS Korean IME, which produces
          // ㅆ for Shift+T and may or may not also report shift in the
          // kitty modifier bits. Without this branch the chord silently
          // fails when the user is in 한글 IME mode.
          || key.name === KOREAN_SHIFTED_T
        ))
        // Alt+T fallback for terminals that collapse Ctrl+T and
        // Ctrl+Shift+T to the same legacy ASCII byte (0x14) — common on
        // tablet terminal apps (Blink/Termius/iSH) that don't enable
        // kitty CSI-u or modifyOtherKeys. Alt+T arrives as `\x1b t`
        // which tui.ts parses as { name: 't', alt: true } (see
        // tui.ts:268-279), so the chord is unambiguous.
        || (key.alt && !key.ctrl && (key.name === 't' || key.name === 'T'))
      )) {
    if (debug.enabled) {
      debug.log('chat.global.match', 'spawn-terminal-modal', {
        name: key.name, ctrl: key.ctrl, shift: key.shift, alt: key.alt ?? false,
      });
    }
    return { kind: 'spawn-terminal-modal' };
  }

  if (opts.allowToggleLogZoom !== false
      && (
        (key.ctrl && (
          (key.shift && (key.name === 'z' || key.name === 'Z'))
          // 'ㅋ' has no shifted form in 2-bul — accept ctrl-only. The
          // trade-off is Ctrl+'ㅋ' (= Ctrl+Z in 한글 IME) also fires this
          // chord, but elanous doesn't bind Ctrl+Z anywhere in chat input
          // so the conflict is moot.
          || key.name === KOREAN_SHIFTED_Z
        ))
        // Alt+Z fallback — same legacy-ASCII collapse rationale as
        // Alt+T above (Ctrl+Z and Ctrl+Shift+Z both encode to 0x1a on
        // tablet terminals without CSI-u).
        || (key.alt && !key.ctrl && (key.name === 'z' || key.name === 'Z'))
      )) {
    if (debug.enabled) {
      debug.log('chat.global.match', 'toggle-log-zoom', {
        name: key.name, ctrl: key.ctrl, shift: key.shift, alt: key.alt ?? false,
      });
    }
    return { kind: 'toggle-log-zoom' };
  }

  // Alt+M (or Alt+ㅡ in 한글 IME · 'ㅡ' is the 2-bul jamo on the M
  // key). Same effect as `display.registerKeyBinding('M-m')` but
  // routed through the chat-input global-action seam — the keybinding
  // registry lives behind the dashboard's main input loop, which
  // chat input owns the readKey for, so global Alt-bindings need this
  // bridge to fire while the user is typing. Mirrors the Alt+T /
  // Alt+Z fallback chord pattern above.
  if (key.alt && !key.ctrl
      && (key.name === 'm' || key.name === 'M' || key.name === 'ㅡ')) {
    if (debug.enabled) {
      debug.log('chat.global.match', 'provider-rotate-next', {
        name: key.name, ctrl: key.ctrl, shift: key.shift, alt: key.alt ?? false,
      });
    }
    return { kind: 'provider-rotate-next' };
  }

  // Diagnostic: capture every Ctrl- or Alt-modified key that didn't
  // match any chord above. Useful for triaging "why doesn't <chord>
  // fire in 한글 IME mode" without re-instrumenting per session —
  // the log shows exactly what `name` arrived and which modifier bits
  // were set.
  if (debug.enabled && (key.ctrl || key.alt)) {
    debug.log('chat.global.miss', key.name || '(empty)', {
      name: key.name, ctrl: key.ctrl, shift: key.shift, alt: key.alt ?? false,
    });
  }
  return null;
}
