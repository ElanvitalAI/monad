import type { HitTarget } from './display/types.js';
import type {
  Menu,
  MenuItem,
} from './ui/context-menu-registry.js';
import type {
  MenuBuildContext,
  MenuProvider,
  MenuProviderRegistry,
} from './ui/context-menu-providers.js';
import {
  getDebugCompanionSpec,
  listDebugCompanionKeys,
  type DebugWorkbenchPane,
} from './window/debug-window-consumers.js';

export type DebugContextMenuMode = 'on' | 'diag' | 'file';

export interface DebugContextMenuDeps {
  getPath: () => string;
  getLevel: () => string;
}

function currentModeForLevel(level: string): DebugContextMenuMode | null {
  if (level === 'diag') return 'diag';
  if (level === 'trail') return 'file';
  if (level === 'normal' || level === 'detail') return 'on';
  return null;
}

function titleForModalId(modalId: string): string {
  if (modalId === 'debug-window') return 'Debug Window';
  if (modalId.startsWith('companion-widget:')) {
    const key = modalId.slice('companion-widget:'.length);
    if ((listDebugCompanionKeys() as readonly string[]).includes(key)) {
      return getDebugCompanionSpec(key as DebugWorkbenchPane).title;
    }
  }
  return 'Debug';
}

export function createDebugContextMenuProvider(
  deps: DebugContextMenuDeps,
): MenuProvider {
  return (hit: HitTarget, _ctx: MenuBuildContext): Menu | null => {
    if (hit.kind !== 'modal-body' && hit.kind !== 'modal-title') return null;
    const modalId = String(hit.modalId);
    const selected = currentModeForLevel(deps.getLevel());
    const modeItems: MenuItem[] = [
      {
        kind: 'single-choice',
        groupId: 'debug-mode',
        id: 'debug.mode.on',
        label: 'On',
        selected: selected === 'on',
      },
      {
        kind: 'single-choice',
        groupId: 'debug-mode',
        id: 'debug.mode.diag',
        label: 'Diag',
        selected: selected === 'diag',
      },
      {
        kind: 'single-choice',
        groupId: 'debug-mode',
        id: 'debug.mode.file',
        label: 'File',
        selected: selected === 'file',
      },
    ];
    return {
      id: `debug:${modalId}`,
      title: titleForModalId(modalId),
      items: [
        {
          kind: 'command',
          id: 'debug.copy-path',
          label: 'Copy current path',
          payload: { path: deps.getPath() },
        },
        {
          kind: 'command',
          id: 'debug.mode',
          label: 'Debug mode change',
          submenu: {
            id: `debug:${modalId}:mode`,
            title: 'Debug mode',
            items: modeItems,
          },
        },
      ],
    };
  };
}

export function registerDebugContextMenus(
  providers: MenuProviderRegistry,
  deps: DebugContextMenuDeps,
): () => void {
  const provider = createDebugContextMenuProvider(deps);
  const unregister: Array<() => void> = [];
  const modalIds = [
    'debug-window',
    ...listDebugCompanionKeys().map((key) => `companion-widget:${key}`),
  ];
  for (const modalId of modalIds) {
    unregister.push(providers.register(`modal-body:${modalId}`, provider));
    unregister.push(providers.register(`modal-title:${modalId}`, provider));
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const unreg of unregister) {
      try { unreg(); } catch { /* swallow */ }
    }
  };
}
