import type { KeyEvent } from '../../plugins/core/types.js';

export interface SearchModalKeyActions {
  type(ch: string): void;
  backspace(): void;
  up(): void;
  down(): void;
  accept(): void;
  cancel(): void;
}

export function routeSearchModalKeyInput(
  key: KeyEvent,
  modal: SearchModalKeyActions,
): 'consumed' {
  const raw = (key as { sequence?: string; raw?: string }).sequence
           ?? (key as { sequence?: string; raw?: string }).raw;
  if (key.name === 'escape' || (key.ctrl && (key.name === 'g' || key.name === 'ㅎ'))) {
    modal.cancel();
  } else if (key.name === 'enter') {
    modal.accept();
  } else if (key.name === 'up' || (key.ctrl && (key.name === 'p' || key.name === 'ㅔ'))) {
    modal.up();
  } else if (key.name === 'down' || (key.ctrl && (key.name === 'n' || key.name === 'ㅜ'))) {
    modal.down();
  } else if (key.name === 'backspace') {
    modal.backspace();
  } else if (key.name === 'space') {
    modal.type(' ');
  } else if (!key.ctrl && key.name.length === 1 && !key.name.startsWith('\x1b')) {
    modal.type(key.name);
  } else if (!key.ctrl && typeof raw === 'string' && raw.length === 1 && raw >= ' ' && raw !== '\x7f') {
    modal.type(raw);
  }
  return 'consumed';
}
