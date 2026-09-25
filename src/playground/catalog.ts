// VP6 — Widget Playground Catalog.
//
// A flat registry of every UX component + built-in widget + common
// modal body that the V7 sandbox can render for verification. Kept
// in `src/` (rather than `widgets/<name>/widget.ts`) so it stays
// inside the TS rootDir alongside `playground-widget.ts`.
//
// Responsibility split:
//   - this module: build + own every sample View / WidgetDef state.
//   - playground-widget.ts: navigation + 3-column layout + preview dispatch.
//
// Two flavors of preview entry:
//   - kind: 'view'   — an LC `View` instance with a `layout()` + `draw()`
//     pair (Button, Dialog, SelectView, …, and also modal bodies).
//   - kind: 'widget' — a `WidgetDef` plus seeded state. Used for the
//     built-in widgets shipped under `widgets/<name>/widget.ts`.

import { Ignored, type EventResult, type Size, type View } from '../ui/view.js';
import type { Printer } from '../ui/printer.js';
import { C } from '../tui.js';
import type { WidgetDef } from '../widgets/types.js';

// UX widgets (LC view library)
import { Button } from '../ui/widgets/button.js';
import { ProgressBar } from '../ui/widgets/progress-bar.js';
import { Accordion, type AccordionSection } from '../ui/widgets/accordion.js';
import { Tabs } from '../ui/widgets/tabs.js';
import { TextArea } from '../ui/widgets/text-area.js';
import { TreeView } from '../ui/widgets/tree-view.js';
import { SelectView } from '../ui/widgets/select-view.js';
import { ComboBox } from '../ui/widgets/combo-box.js';
import { ListView } from '../ui/widgets/list-view.js';
import { createPromptEditView } from '../ui/widgets/edit-view.js';
import type { FileEntry } from '../ui/widgets/file-dialog.js';
import { DraggableList } from '../ui/widgets/draggable-list.js';
import { ToastStack } from '../ui/widgets/toast-stack.js';
import { TitleBar } from '../ui/widgets/title-bar.js';
import {
  buildWidgetLabPresetNodes,
  buildWidgetSpec,
  command,
  contextMenuWidget,
  createDeclarativeRuntimeArtifact,
  dialogButton,
  dialogWidget,
  fileDialogWidget,
  intakeReviewWidget,
  intakeAction,
  option,
  permissionPromptWidget,
  question,
  requestUserInputWidget,
  materializeWidgetSpecs,
  renderWidgetSpecPreviewCard,
  resolveDeclarativeRuntimeSupport,
  slashMenuWidget,
  tooltipWidget,
  type DeclarativeDialogButtonBuilder,
  type DeclarativeDialogButtonSpec,
  type DeclarativeIntakeActionBuilder,
  type DeclarativeIntakeActionSpec,
  type DeclarativeWidgetNode,
  type DeclarativeViewRuntimeDeps,
  type WidgetSpec,
} from '../ui/declarative/index.js';
import { CATPPUCCIN_MOCHA } from '../themes/index.js';
import {
  resolveDialogChromeSpec,
  resolveEmbeddedDialogChromeSpec,
  resolveModalDialogChromeSpec,
} from '../ui/chrome/dialog-chrome.js';
import { resolvePickerChromeSpec } from '../ui/chrome/picker-chrome.js';
import { resolveTooltipChromeSpec } from '../ui/chrome/tooltip-chrome.js';
import {
  resolveModalWindowChromeSpec,
  resolvePickerWindowChromeSpec,
  resolveWindowChromeSpec,
} from '../ui/chrome/window-chrome.js';
import { createIulSidebarShellView } from '../iul/sidebar-shell.js';

// Built-in widget defs are pulled from the WidgetHost registry at
// catalog-build time. Direct imports of `../widgets/*` would cross
// the TS rootDir and re-trigger the cross-boundary error the original
// `playground-widget.ts` note warns about. See setWidgetHostForCatalog
// below — the dashboard sets the host after discover() runs.
import type { WidgetHost } from '../widgets/host.js';

export type CatalogGroup = 'ux' | 'widget' | 'modal';

/** Shape-preserving union — `kind` picks the render path. */
export type CatalogView =
  | { kind: 'view'; view: View }
  | { kind: 'widget'; def: WidgetDef<any, any>; state: unknown; character: string };

export interface CatalogEntry {
  id: string;               // stable slug ('ux.button', 'widget.chart-line', 'modal.dialog-approval')
  title: string;
  group: CatalogGroup;
  summary: string;
  /** Shown on the inspect line. Kept shallow for readability. */
  props: Record<string, unknown>;
  /** Pre-built renderable. Eager construction so async-loaded views
   *  (FileDialog) have time to resolve before the user navigates. */
  view: CatalogView;
}

export interface CatalogGroupMeta {
  id: CatalogGroup;
  label: string;
  description: string;
}

export const CATALOG_GROUPS: CatalogGroupMeta[] = [
  { id: 'ux',     label: 'UX Components', description: 'LC View-based primitives from src/ui/widgets/*' },
  { id: 'widget', label: 'Widgets',       description: 'WidgetDef modules from widgets/<name>/widget.ts' },
  { id: 'modal',  label: 'Modals',        description: 'Full modal bodies — confirm / approval / picker / overlay' },
];

// ─── Adapters ───────────────────────────────────────────────────────

/** Wrap a ToastStack (not a View) so the preview pane can draw it. */
class ToastStackPreview implements View {
  constructor(private readonly stack: ToastStack) {}
  draw(p: Printer): void {
    p.text(0, 0, C.muted('── ToastStack preview (fixed toasts, top-right placement) ──'));
    this.stack.render(p);
  }
  onEvent(): EventResult { return Ignored; }
  layout(_size: Size): void { /* no-op */ }
  requiredSize(c: Size): Size { return { width: Math.min(c.width, 60), height: Math.min(c.height, 8) }; }
  takeFocus(): boolean { return false; }
}

/** Wrap a TitleBar demo so it paints both the title row and a body hint. */
class TitleBarPreview implements View {
  constructor(private readonly bar: TitleBar) {}
  draw(p: Printer): void {
    const row = p.sub(0, 0, p.width, 1);
    this.bar.draw(row);
    if (p.height > 2) {
      p.text(0, 2, C.muted('↑ MX9 TitleBar: click-drag between panes to swap positions.'));
    }
    if (p.height > 3) {
      p.text(0, 3, C.muted('  Right-click a title for the pane\'s context menu.'));
    }
  }
  onEvent(): EventResult { return Ignored; }
  layout(_size: Size): void { /* TitleBar.layout is a no-op; no caching required */ }
  requiredSize(c: Size): Size { return { width: c.width, height: Math.min(c.height, 4) }; }
  takeFocus(): boolean { return false; }
}

class DeclarativeSpecPreview implements View {
  constructor(
    private readonly specs: readonly DeclarativeWidgetNode[],
    private readonly title: string,
  ) {}

  draw(p: Printer): void {
    if (this.specs.length === 0) {
      p.text(0, 0, C.muted('  (empty declarative preset)'));
      return;
    }
    const materialized = materializeWidgetSpecs({
      spawn: (opts) => ({ id: opts.id ?? opts.type }),
    }, this.specs);
    const primary = buildWidgetSpec(this.specs[0]!);
    const runtime = resolveDeclarativeRuntimeSupport(primary, { host: sharedHost });
    const lines = renderWidgetSpecPreviewCard({
      ...primary,
      chrome: {
        ...(primary.chrome ?? {}),
        footer: [
          primary.chrome?.footer,
          `materialized:${materialized.map(record => record.widgetId).join(',')}`,
          `runtime:${runtime.kinds.length > 0 ? runtime.kinds.join('+') : 'none'}`,
        ].filter(Boolean).join(' · '),
      },
    }, p.width, Math.max(4, Math.min(p.height - 1, 7)), CATPPUCCIN_MOCHA, { motionProgress: 1 });
    for (let y = 0; y < Math.min(lines.length, p.height); y++) p.text(0, y, lines[y] ?? '');
    if (p.height > lines.length) {
      p.text(0, lines.length, C.muted(` preset · ${this.title} · ${this.specs.length} widgets`));
    }
  }

  onEvent(): EventResult { return Ignored; }
  layout(_size: Size): void { /* no-op */ }
  requiredSize(c: Size): Size { return { width: Math.min(c.width, 60), height: Math.min(c.height, 8) }; }
  takeFocus(): boolean { return false; }
}

// ─── Builders ───────────────────────────────────────────────────────

function accordionSections(): AccordionSection[] {
  return [
    { title: 'Details', content: new TextArea({ text: 'Item details go here.', readOnly: true }), openHeight: 2, openByDefault: true },
    { title: 'Advanced', content: new TextArea({ text: 'Expert flags.',          readOnly: true }), openHeight: 2 },
    { title: 'Raw',      content: new TextArea({ text: 'Opaque dump.',           readOnly: true }), openHeight: 2 },
  ];
}

function sampleFileEntries(path: string): FileEntry[] {
  if (path.endsWith('/src') || path === '/src') {
    return [
      { name: 'ui',         isDirectory: true },
      { name: 'panes',      isDirectory: true },
      { name: 'widgets',    isDirectory: true },
      { name: 'playground-widget.ts',   isDirectory: false },
      { name: 'playground-catalog.ts',  isDirectory: false },
    ];
  }
  return [
    { name: 'src',   isDirectory: true },
    { name: 'test',  isDirectory: true },
    { name: 'docs',  isDirectory: true },
    { name: 'package.json', isDirectory: false },
    { name: 'README.md',    isDirectory: false },
  ];
}

function buildDeclarativeCatalogView(
  spec: DeclarativeWidgetNode,
  deps?: DeclarativeViewRuntimeDeps,
): View {
  const artifact = createDeclarativeRuntimeArtifact(spec, {
    host: sharedHost,
    prefer: 'view',
    ...(deps ? { viewDeps: deps } : {}),
  });
  if (artifact.kind !== 'view') {
    throw new Error(`catalog entry "${artifact.spec.type}" resolved to widget runtime`);
  }
  return artifact.view;
}

function buildPermissionPromptCatalogSpec(
  title: string,
  body: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  choices: readonly ReturnType<typeof option>[],
): DeclarativeWidgetNode {
  return permissionPromptWidget(title)
    .setBody(body)
    .setChoices(choices)
    .setChrome(chrome);
}

function buildDialogCatalogSpec(
  chromeTitle: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  body: string,
  buttons: readonly (string | DeclarativeDialogButtonSpec | DeclarativeDialogButtonBuilder)[],
): DeclarativeWidgetNode {
  return dialogWidget('dialog', chromeTitle)
    .setBody(body)
    .setButtons(buttons)
    .setChrome(chrome);
}

function catalogModalDialogChrome(
  title: string,
  opts?: { titleAlign?: NonNullable<WidgetSpec['chrome']>['titleAlign'] },
): NonNullable<WidgetSpec['chrome']> {
  return resolveModalDialogChromeSpec(title, undefined, opts?.titleAlign);
}

function catalogEmbeddedDialogChrome(
  title: string,
  opts?: { titleAlign?: NonNullable<WidgetSpec['chrome']>['titleAlign'] },
): NonNullable<WidgetSpec['chrome']> {
  return resolveEmbeddedDialogChromeSpec(title, undefined, opts?.titleAlign);
}

function catalogPanelPickerChrome(
  title: string,
  primaryAction: string,
): NonNullable<WidgetSpec['chrome']> {
  return resolvePickerChromeSpec({
    title,
    primaryAction,
    defaultVariant: 'panel',
    defaultShowClose: false,
  });
}

function catalogComboPanelChrome(
  title: string,
): NonNullable<WidgetSpec['chrome']> {
  return catalogPanelPickerChrome(title, 'submit');
}

function catalogCommandPanelChrome(
  title: string,
): NonNullable<WidgetSpec['chrome']> {
  return catalogPanelPickerChrome(title, 'run');
}

function catalogMenuPanelChrome(
  title: string,
): NonNullable<WidgetSpec['chrome']> {
  return catalogPanelPickerChrome(title, 'pick');
}

function catalogModalWindowChrome(
  title: string,
): NonNullable<WidgetSpec['chrome']> {
  return resolveModalWindowChromeSpec(title);
}

function catalogPickerWindowChrome(
  title: string,
): NonNullable<WidgetSpec['chrome']> {
  return resolvePickerWindowChromeSpec(title);
}

function catalogTooltipChrome(
  title: string,
): NonNullable<WidgetSpec['chrome']> {
  return resolveTooltipChromeSpec({ title });
}

function buildTooltipCatalogSpec(
  title: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  text: string,
  ttlMs: number,
): DeclarativeWidgetNode {
  return tooltipWidget('tooltip', title)
    .setText(text)
    .setTtl(ttlMs)
    .setChrome(chrome);
}

function buildSlashMenuCatalogSpec(
  title: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  commands: readonly ReturnType<typeof command>[],
): DeclarativeWidgetNode {
  return slashMenuWidget(title)
    .setCommands(commands)
    .setChrome(chrome);
}

function buildContextMenuCatalogSpec(
  title: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  items: readonly ReturnType<typeof option>[],
): DeclarativeWidgetNode {
  return contextMenuWidget(title)
    .setItems(items)
    .setChrome(chrome);
}

function buildFileDialogCatalogSpec(
  title: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  config: {
    startDir: string;
    mode: 'open' | 'save' | 'dir';
    defaultName?: string;
  },
): DeclarativeWidgetNode {
  const builder = fileDialogWidget(title)
    .setStartDir(config.startDir)
    .setMode(config.mode)
    .setChrome(chrome);
  return config.defaultName ? builder.setDefaultName(config.defaultName) : builder;
}

function buildRequestUserCatalogSpec(
  title: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  questions: readonly ReturnType<typeof question>[],
): DeclarativeWidgetNode {
  return requestUserInputWidget(title)
    .allowBackNav()
    .setQuestions(questions)
    .setChrome(chrome);
}

function buildIntakeReviewCatalogSpec(
  title: string,
  chrome: NonNullable<WidgetSpec['chrome']>,
  body: string,
  actions: readonly (string | DeclarativeIntakeActionSpec | DeclarativeIntakeActionBuilder)[],
  questions?: readonly ReturnType<typeof question>[],
): DeclarativeWidgetNode {
  const builder = intakeReviewWidget(title)
    .setBody(body)
    .setActions(actions)
    .setChrome(chrome);
  return questions ? builder.setQuestions(questions) : builder;
}

// ─── UX group ───────────────────────────────────────────────────────

function buildUxEntries(
  opts: {
    includeSidebarShellDemo?: boolean;
  } = {},
): CatalogEntry[] {
  const out: CatalogEntry[] = [];

  out.push({
    id: 'ux.button',
    title: 'Button',
    group: 'ux',
    summary: 'Bracketed label with onClick. Enter/Space triggers when focused.',
    props: { style: 'primary', label: 'Primary' },
    view: { kind: 'view', view: new Button({ label: 'Primary Action', onClick: () => {}, style: 'primary' }) },
  });

  out.push({
    id: 'ux.progress-bar',
    title: 'ProgressBar',
    group: 'ux',
    summary: 'Fractional progress with optional label.',
    props: { total: 100, current: 62, label: 'downloading' },
    view: { kind: 'view', view: new ProgressBar({ total: 100, current: 62, label: 'downloading' }) },
  });

  out.push({
    id: 'ux.tooltip',
    title: 'Tooltip',
    group: 'ux',
    summary: 'Non-modal hint bubble with TTL.',
    props: {
      text: 'Tip: arrow keys to cycle slots.',
      ttlMs: 1e9,
      chromeSpec: catalogTooltipChrome('Declarative hint'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildTooltipCatalogSpec(
        'Declarative hint',
        catalogTooltipChrome('Declarative hint'),
        'Tip: arrow keys to cycle slots.',
        1e9,
      )),
    },
  });

  out.push({
    id: 'ux.declarative-telemetry-lab',
    title: 'Declarative Telemetry Lab',
    group: 'ux',
    summary: 'YAML-first telemetry preset rendered through the IUL preview pipeline.',
    props: { preset: 'telemetry-stack', source: 'WidgetLabPreset' },
    view: {
      kind: 'view',
      view: new DeclarativeSpecPreview(buildWidgetLabPresetNodes('telemetry-stack'), 'Telemetry Stack'),
    },
  });

  out.push({
    id: 'ux.declarative-hover-lab',
    title: 'Declarative Hover Lab',
    group: 'ux',
    summary: 'Tooltip + toast overlay preset using declarative chrome and materialize parity.',
    props: { preset: 'hover-overlay', source: 'WidgetLabPreset' },
    view: {
      kind: 'view',
      view: new DeclarativeSpecPreview(buildWidgetLabPresetNodes('hover-overlay'), 'Hover Overlay'),
    },
  });

  out.push({
    id: 'ux.accordion',
    title: 'Accordion',
    group: 'ux',
    summary: 'Collapsible sections with per-section height.',
    props: { sections: ['Details', 'Advanced', 'Raw'] },
    view: { kind: 'view', view: new Accordion({ sections: accordionSections() }) },
  });

  if (opts.includeSidebarShellDemo !== false) {
    out.push({
      id: 'ux.sidebar-tab-surface',
      title: 'SidebarTabSurface',
      group: 'ux',
      summary: 'Left rail / right detail shell for ACP channels and IUL-style labs.',
      props: { rail: ['Theme', 'Event Lab', 'Widget Presets'], active: 'Theme' },
      view: {
        kind: 'view',
        view: createIulSidebarShellView({
          title: 'IUL UX Lab',
          footerHint: '↑↓ switch experiment · Tab move focus · same VW, different detail',
        }),
      },
    });
  }

  out.push({
    id: 'ux.tabs',
    title: 'Tabs',
    group: 'ux',
    summary: 'Horizontal tab bar with one content pane at a time.',
    props: { tabs: ['Alpha', 'Beta', 'Gamma'], active: 0 },
    view: {
      kind: 'view',
      view: new Tabs({
        tabs: [
          { title: 'Alpha', content: new TextArea({ text: 'Alpha pane — code preview.',  readOnly: true }) },
          { title: 'Beta',  content: new TextArea({ text: 'Beta pane — notes.',         readOnly: true }) },
          { title: 'Gamma', content: new TextArea({ text: 'Gamma pane — log trail.',    readOnly: true }) },
        ],
      }),
    },
  });

  out.push({
    id: 'ux.text-area',
    title: 'TextArea',
    group: 'ux',
    summary: 'Wrapping multi-line text with optional readOnly.',
    props: { readOnly: true, lines: 4 },
    view: {
      kind: 'view',
      view: new TextArea({
        text: 'Line one of a read-only text area.\nLine two wraps if needed.\nLine three continues.\nLine four — last line.',
        readOnly: true,
        wrap: true,
      }),
    },
  });

  out.push({
    id: 'ux.tree-view',
    title: 'TreeView',
    group: 'ux',
    summary: 'Keyboard-navigable tree with expand/collapse.',
    props: { depth: 3, roots: 2 },
    view: {
      kind: 'view',
      view: new TreeView<string>({
        root: [
          { label: 'src', value: 'src', children: [
            { label: 'ui', value: 'ui', children: [
              { label: 'widgets', value: 'widgets' },
              { label: 'layout',  value: 'layout' },
            ]},
            { label: 'panes', value: 'panes' },
          ]},
          { label: 'test',   value: 'test' },
          { label: 'docs',   value: 'docs' },
        ],
        onPick: () => {},
        onCancel: () => {},
      }),
    },
  });

  out.push({
    id: 'ux.select-view',
    title: 'SelectView',
    group: 'ux',
    summary: 'Single-pick list with optional search + description.',
    props: { options: ['Apple', 'Banana', 'Cherry'] },
    view: {
      kind: 'view',
      view: new SelectView<string>({
        options: [
          { value: 'a', label: 'Apple',   description: 'Pome fruit' },
          { value: 'b', label: 'Banana',  description: 'Tropical berry' },
          { value: 'c', label: 'Cherry',  description: 'Stone fruit' },
        ],
        onSubmit: () => {},
        onCancel: () => {},
      }),
    },
  });

  out.push({
    id: 'ux.combo-box',
    title: 'ComboBox',
    group: 'ux',
    summary: 'Inline editable select with fuzzy filter.',
    props: {
      options: ['red', 'green', 'blue'],
      selected: 'green',
      chromeSpec: catalogComboPanelChrome('Declarative combo'),
    },
    view: {
      kind: 'view',
      view: new ComboBox<string>({
        title: 'Color chooser',
        chromeSpec: catalogComboPanelChrome('Declarative combo'),
        options: [
          { value: 'red',   label: 'red' },
          { value: 'green', label: 'green' },
          { value: 'blue',  label: 'blue' },
        ],
        initialValue: 'green',
        onSubmit: () => {},
      }),
    },
  });

  out.push({
    id: 'ux.list-view',
    title: 'ListView',
    group: 'ux',
    summary: 'Multi-column list with header + cursor row.',
    props: { columns: ['Name', 'Type', 'Size'], rows: 4 },
    view: {
      kind: 'view',
      view: new ListView<{ name: string; kind: string; size: string }>({
        columns: [
          { title: 'Name', width: 18 },
          { title: 'Kind', width: 8 },
          { title: 'Size', align: 'right' },
        ],
        rows: [
          { name: 'button.ts',       kind: 'file', size: '2.3K' },
          { name: 'dialog.ts',       kind: 'file', size: '4.1K' },
          { name: 'accordion.ts',    kind: 'file', size: '3.2K' },
          { name: 'select-view.ts',  kind: 'file', size: '14.6K' },
        ],
        render: r => [r.name, r.kind, r.size],
      }),
    },
  });

  out.push({
    id: 'ux.edit-view',
    title: 'EditView',
    group: 'ux',
    summary: 'Single-line text input with Ctrl+U / Ctrl+W kills.',
    props: { placeholder: 'Type something', maxLength: 120 },
    view: {
      kind: 'view',
      view: createPromptEditView({
        initialValue: 'editable single line',
        placeholder: 'Type something',
        maxLength: 120,
      }),
    },
  });

  out.push({
    id: 'ux.dialog',
    title: 'Dialog',
    group: 'ux',
    summary: 'Bordered container with title + body + button bar.',
    props: {
      title: 'Save changes?',
      buttons: ['Yes', 'No', 'Cancel'],
      chromeSpec: catalogModalDialogChrome('Declarative dialog'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildDialogCatalogSpec(
        'Declarative dialog',
        catalogModalDialogChrome('Declarative dialog', { titleAlign: 'center' }),
        'You have unsaved edits in 3 files. Save before closing?',
        [
          dialogButton('Yes', 'yes').setShortcut('y'),
          dialogButton('No', 'no').setShortcut('n'),
          dialogButton('Cancel', 'cancel').setShortcut('c'),
        ],
      )),
    },
  });

  out.push({
    id: 'ux.file-dialog',
    title: 'FileDialog',
    group: 'ux',
    summary: 'Open/save/dir picker with breadcrumbs (mock readDir).',
    props: {
      mode: 'open',
      startDir: '/src',
      chromeSpec: catalogPickerWindowChrome('Spec file picker'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildFileDialogCatalogSpec(
        'Spec file picker',
        catalogPickerWindowChrome('Spec file picker'),
        {
          startDir: '/src',
          mode: 'open',
        },
      ), {
        readDir: (p: string) => sampleFileEntries(p),
        onFileSubmit: () => {},
        onCancel: () => {},
      }),
    },
  });

  out.push({
    id: 'ux.permission-prompt',
    title: 'PermissionPrompt',
    group: 'ux',
    summary: 'Allow / Deny / Always with feedback-on-deny.',
    props: {
      title: 'Allow edit to src/playground-widget.ts?',
      chromeSpec: catalogEmbeddedDialogChrome('Declarative permission'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildPermissionPromptCatalogSpec(
        'Allow edit to src/playground-widget.ts?',
        'Claude is about to replace 140 lines. Review the diff before approving.',
        catalogEmbeddedDialogChrome('Declarative permission'),
        [
          option('Allow', 'allow').setShortcut('a').setPositive(),
          option('Always', 'always').setShortcut('l').setPositive(),
          option('Deny', 'deny').setShortcut('d'),
        ],
      ), {
        onPermissionSubmit: () => {},
      }),
    },
  });

  out.push({
    id: 'ux.slash-menu',
    title: 'SlashMenu',
    group: 'ux',
    summary: 'Searchable slash-command picker.',
    props: {
      commands: ['/status', '/switch', '/compact', '/undo'],
      chromeSpec: catalogCommandPanelChrome('Declarative commands'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildSlashMenuCatalogSpec(
        '/ commands',
        catalogCommandPanelChrome('Declarative commands'),
        [
          command('/status', 'Print workspace + model status').setCategory('core'),
          command('/switch', 'Switch the active model').setCategory('model'),
          command('/compact', 'Compact the conversation').setCategory('context'),
          command('/undo', 'Undo the last turn\'s writes').setCategory('edit'),
          command('/widget', 'Widget host controls').setCategory('dev'),
        ],
      )),
    },
  });

  out.push({
    id: 'ux.context-menu',
    title: 'ContextMenu',
    group: 'ux',
    summary: 'Anchored floating menu triggered by right-click or chord.',
    props: {
      items: ['Open', 'Rename', 'Duplicate', 'Delete'],
      chromeSpec: catalogMenuPanelChrome('Declarative menu'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildContextMenuCatalogSpec(
        'Declarative menu',
        catalogMenuPanelChrome('Declarative menu'),
        [
          option('Open', 'open').setShortcut('o'),
          option('Rename', 'rename').setShortcut('r'),
          option('Duplicate', 'duplicate').setShortcut('d'),
          option('Delete', 'delete').setShortcut('x').setDisabled(),
        ],
      )),
    },
  });

  out.push({
    id: 'ux.draggable-list',
    title: 'DraggableList',
    group: 'ux',
    summary: 'Mouse-draggable reorderable list (click = pick).',
    props: { items: 4, reorder: true },
    view: {
      kind: 'view',
      view: new DraggableList<string>({
        items: ['alpha', 'beta', 'gamma', 'delta'],
        labelOf: (s) => s,
        title: 'Persona order',
        onPick: () => {},
        onReorder: () => {},
      }),
    },
  });

  // ToastStack — wrap via adapter, seed 3 fixed toasts.
  const toast = new ToastStack({ placement: 'top-right', maxVisible: 3, theme: CATPPUCCIN_MOCHA });
  toast.push({ text: 'Saved /src/playground-catalog.ts', kind: 'success', ttlMs: 0 });
  toast.push({ text: 'Connection flaky — retrying', kind: 'warning', ttlMs: 0 });
  toast.push({ text: 'Model switched to Opus 4.7', kind: 'info', ttlMs: 0 });
  out.push({
    id: 'ux.toast-stack',
    title: 'ToastStack',
    group: 'ux',
    summary: 'Corner-stacked transient messages.',
    props: { placement: 'top-right', toasts: 3, theme: CATPPUCCIN_MOCHA.name },
    view: { kind: 'view', view: new ToastStackPreview(toast) },
  });

  // TitleBar — wrapped adapter for the pane-title drag handle.
  const title = new TitleBar({ title: 'Preview', paneId: 'preview' });
  out.push({
    id: 'ux.title-bar',
    title: 'TitleBar',
    group: 'ux',
    summary: 'Drag-handle pane title row (MX9).',
    props: { paneId: 'preview' },
    view: { kind: 'view', view: new TitleBarPreview(title) },
  });

  out.push({
    id: 'ux.request-user-input-overlay',
    title: 'RequestUserInputOverlay',
    group: 'ux',
    summary: 'Multi-question queue with optional back-nav + notes.',
    props: {
      questions: 2,
      allowBackNav: true,
      chromeSpec: catalogEmbeddedDialogChrome('Declarative ask-user'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(
        buildRequestUserCatalogSpec(
          'Declarative ask-user',
          catalogEmbeddedDialogChrome('Declarative ask-user'),
          [
            question('scope', 'What scope should we ship?').setOptions([
              option('Small   (this pane only)', 'small'),
              option('Medium  (related panes)', 'medium'),
              option('Large   (cross-cutting)', 'large'),
            ]),
            question('notes', 'Anything else to flag?')
              .setInputType({ placeholder: 'Optional notes' })
              .allowNotes(),
          ],
        ),
      ),
    },
  });

  out.push({
    id: 'ux.intake-review',
    title: 'IntakeReview',
    group: 'ux',
    summary: 'Declarative intake review surface that flips between clarify and review actions.',
    props: {
      state: 'review-ready',
      actions: 3,
      chromeSpec: catalogEmbeddedDialogChrome('Review intake · intake-42'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildIntakeReviewCatalogSpec(
        'Review intake · intake-42',
        catalogEmbeddedDialogChrome('Review intake · intake-42'),
        'Intake: intake-42\nState: review-ready\nTitle: compare two repos\nSummary: 2 intake item(s) extracted from the current note.',
        [
          intakeAction('Apply now', { kind: 'decide-apply-now', intakeId: 'intake-42' }),
          intakeAction('Keep in backlog', { kind: 'decide-backlog-only', intakeId: 'intake-42' }),
          intakeAction('Generate task proposal', { kind: 'propose', intakeId: 'intake-42' }),
        ],
      )),
    },
  });

  return out;
}

// ─── Widget group ───────────────────────────────────────────────────

/** Host provider injected from dashboard.ts once widget-host.discover()
 *  has registered the built-in widgets. Tests that don't wire a host
 *  simply receive an empty widget group from the catalog. */
let sharedHost: WidgetHost | null = null;
export function setWidgetHostForCatalog(host: WidgetHost | null): void {
  sharedHost = host;
  // Force rebuild on next getCatalog() so widget entries reflect the host.
  CACHED_CATALOG = null;
}

/** Seed a WidgetDef state via its initialState + a partial patch. Used
 *  to set fields that the Config doesn't expose (e.g. focused: true). */
function seedState<S>(def: WidgetDef<S>, config: unknown, patch: Partial<S>): S {
  const base = def.initialState(config as never);
  return { ...(base as object), ...(patch as object) } as S;
}

interface WidgetSeedSpec {
  type: string;
  /** Display title (falls back to def.type). */
  title?: string;
  /** Inspect props blurb. */
  props: Record<string, unknown>;
  /** Config passed to initialState. */
  config?: unknown;
  /** State patch applied after initialState (e.g. { focused: true }). */
  patch?: Record<string, unknown>;
  /** Character override (falls back to def.defaultCharacter). */
  character?: string;
}

const WIDGET_SEEDS: WidgetSeedSpec[] = [
  {
    type: 'hello-text',
    props: { message: 'Hello, world!' },
    config: { message: 'Hello, Widget Playground!' },
    character: 'Hello',
  },
  {
    type: 'list',
    props: { items: 5 },
    config: { items: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] },
    patch: { focused: true },
    character: 'Sample list',
  },
  {
    type: 'markdown',
    props: { lines: 6 },
    config: {
      text:
`# Markdown widget

**Bold** · *italic* · \`inline code\`

- Bullet one
- Bullet two

\`\`\`ts
const sum = (a: number, b: number) => a + b;
\`\`\``,
    },
    patch: { focused: true },
    character: 'README',
  },
  {
    type: 'chart-line',
    props: { samples: 24, unit: '%' },
    config: {
      series: [12, 18, 21, 19, 25, 33, 38, 42, 40, 36, 45, 52, 58, 62, 60, 64, 70, 68, 72, 75, 73, 78, 82, 80],
      unit: '%',
      color: 'success',
    },
    character: 'Cache hit %',
  },
  {
    type: 'table',
    props: { rows: 5, cols: 4 },
    config: {
      columns: [
        { key: 'persona', header: 'Persona', width: 18 },
        { key: 'stance',  header: 'Stance',  width: 10 },
        { key: 'conf',    header: 'Conf',    width: 6, align: 'right' },
        { key: 'note',    header: 'Note',    width: 'flex' },
      ],
      rows: [
        { persona: 'Park Ji-hoon',   stance: 'bull',    conf: 0.72, note: 'HBM3 capex inflection' },
        { persona: 'Dana R.',        stance: 'bear',    conf: 0.61, note: 'Margin compression ahead' },
        { persona: 'Kim Minju',      stance: 'neutral', conf: 0.55, note: 'Wait for Q2 print' },
        { persona: 'Carlos V.',      stance: 'bull',    conf: 0.80, note: 'AI demand > skepticism' },
        { persona: 'Sato Ayaka',     stance: 'bear',    conf: 0.64, note: 'Inventory overhang' },
      ],
    },
    patch: { focused: true },
    character: 'Consensus',
  },
  {
    type: 'result-card',
    props: { stance: 'bull', confidence: 0.72 },
    config: {
      personaName: 'Park Ji-hoon',
      personaRole: '한국 액티브 펀드매니저',
      stance: 'bull',
      confidence: 0.72,
      summary: 'HBM3 capex inflection — Samsung has entry advantage but NVIDIA allocation still clouded.',
    },
    patch: { focused: true },
    character: 'Park Ji-hoon',
  },
  {
    type: 'agent-list',
    props: { emptyLabel: '(no agents running)' },
    config: { emptyLabel: '(no agents running)' },
    character: 'Agents',
  },
  {
    type: 'agent-detail',
    props: { emptyLabel: '(select an agent)' },
    config: { emptyLabel: '(select an agent)' },
    character: 'Agent detail',
  },
  {
    type: 'agent-modal',
    props: { footer: 'Press Enter to expand the full trail.' },
    config: { footer: 'Press Enter to expand the full trail.' },
    character: 'Agent',
  },
  {
    type: 'scheduler-task-list',
    props: { cards: 0 },
    config: { emptyLabel: '(no scheduled tasks)' },
    character: 'Ready',
  },
  {
    type: 'log',
    props: { lines: 6, scrollOffset: -1 },
    config: {
      lines: [
        '[playground] widget-host ready',
        '[playground] registered 11 built-in widgets',
        '[playground] cursor → ux.button',
        '[playground] cursor → ux.select-view',
        '[playground] cursor → widget.chart-line',
        '[playground] reload requested',
      ],
    },
    character: 'Log',
  },
];

function buildWidgetEntries(): CatalogEntry[] {
  if (!sharedHost) return [];
  const registry = sharedHost.available();
  const byType = new Map(registry.map(e => [e.def.type, e.def] as const));
  const out: CatalogEntry[] = [];
  for (const seed of WIDGET_SEEDS) {
    const def = byType.get(seed.type);
    if (!def) continue;
    const state = seed.patch
      ? seedState<unknown>(def as WidgetDef<unknown>, seed.config, seed.patch as Partial<unknown>)
      : def.initialState(seed.config as never);
    out.push({
      id: `widget.${seed.type}`,
      title: seed.title ?? seed.type,
      group: 'widget',
      summary: def.description,
      props: seed.props,
      view: {
        kind: 'widget',
        def,
        state,
        character: seed.character ?? def.defaultCharacter ?? seed.type,
      },
    });
  }
  return out;
}

// ─── Modal group ────────────────────────────────────────────────────

function buildModalEntries(): CatalogEntry[] {
  const out: CatalogEntry[] = [];

  out.push({
    id: 'modal.dialog-confirm',
    title: 'Dialog (Confirm)',
    group: 'modal',
    summary: 'Two-button yes/no confirmation body.',
    props: {
      title: 'Discard changes?',
      buttons: ['Discard', 'Keep'],
      chromeSpec: catalogModalDialogChrome('Confirm action'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildDialogCatalogSpec(
        'Confirm action',
        catalogModalDialogChrome('Confirm action'),
        'This will drop 3 uncommitted edits. Continue?',
        [
          dialogButton('Discard', 'discard').setShortcut('d').setStyle('danger'),
          dialogButton('Keep', 'keep').setShortcut('k').setStyle('primary'),
        ],
      ), {
        onDialogSubmit: () => {},
        onCancel: () => {},
      }),
    },
  });

  out.push({
    id: 'modal.dialog-approval',
    title: 'Dialog (Approval)',
    group: 'modal',
    summary: 'Approval modal body used by approval-modal.ts.',
    props: {
      title: 'Allow this edit?',
      chromeSpec: catalogModalDialogChrome('Approval gate'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildDialogCatalogSpec(
        'Approval gate',
        catalogModalDialogChrome('Approval gate', { titleAlign: 'center' }),
        'src/playground-widget.ts — replace 140 lines',
        [
          dialogButton('Allow', 'allow').setShortcut('a').setStyle('primary'),
          dialogButton('Always', 'always').setShortcut('l'),
          dialogButton('Deny', 'deny').setShortcut('d').setStyle('danger'),
        ],
      ), {
        onDialogSubmit: () => {},
        onCancel: () => {},
      }),
    },
  });

  out.push({
    id: 'modal.declarative-approval-lab',
    title: 'Declarative Approval Lab',
    group: 'modal',
    summary: 'Dialog preset sourced from the IUL YAML-first authoring rack.',
    props: { preset: 'approval-dialog', source: 'WidgetLabPreset' },
    view: {
      kind: 'view',
      view: new DeclarativeSpecPreview(buildWidgetLabPresetNodes('approval-dialog'), 'Approval Dialog'),
    },
  });

  out.push({
    id: 'modal.permission-prompt',
    title: 'PermissionPrompt (modal)',
    group: 'modal',
    summary: 'PermissionPrompt body — feedback-on-deny enabled.',
    props: {
      title: 'Approve destructive Bash?',
      chromeSpec: catalogModalDialogChrome('Approval prompt'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildPermissionPromptCatalogSpec(
        'Approve destructive Bash?',
        'rm -rf /tmp/monad-session-q',
        catalogModalDialogChrome('Approval prompt'),
        [
          option('Allow once', 'allow').setShortcut('a').setPositive(),
          option('Deny', 'deny').setShortcut('d'),
        ],
      ), {
        onPermissionSubmit: () => {},
      }),
    },
  });

  out.push({
    id: 'modal.slash-menu',
    title: 'SlashMenu (modal)',
    group: 'modal',
    summary: 'Slash command picker body.',
    props: {
      commands: 6,
      chromeSpec: catalogModalWindowChrome('Modal commands'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildSlashMenuCatalogSpec(
        '/ commands',
        catalogModalWindowChrome('Modal commands'),
        [
          command('/wd', 'Change session working directory').setCategory('swd'),
          command('/git', 'Git status + branch switch').setCategory('git'),
          command('/branch', 'Create / switch branch').setCategory('git'),
          command('/plan', 'Enter plan mode').setCategory('wf'),
          command('/undo', 'Undo last turn').setCategory('edit'),
          command('/widget', 'Widget host controls').setCategory('dev'),
        ],
      ), {
        onCancel: () => {},
      }),
    },
  });

  out.push({
    id: 'modal.context-menu',
    title: 'ContextMenu (modal)',
    group: 'modal',
    summary: 'Anchored context menu body.',
    props: {
      items: 5,
      chromeSpec: catalogModalWindowChrome('Pane actions'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildContextMenuCatalogSpec(
        'Pane actions',
        catalogModalWindowChrome('Pane actions'),
        [
          option('Pin pane', 'pin').setShortcut('p'),
          option('Swap with…', 'swap').setShortcut('s'),
          option('Split horizontally', 'split-h').setShortcut('h'),
          option('Split vertically', 'split-v').setShortcut('v'),
          option('Close pane', 'close').setShortcut('x').setDisabled(),
        ],
      ), {
        onContextPick: () => {},
      }),
    },
  });

  out.push({
    id: 'modal.file-dialog',
    title: 'FileDialog (modal)',
    group: 'modal',
    summary: 'File picker body with breadcrumbs + mock dir.',
    props: {
      mode: 'save',
      startDir: '/',
      chromeSpec: catalogModalWindowChrome('Save artifact'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(buildFileDialogCatalogSpec(
        'Save artifact',
        catalogModalWindowChrome('Save artifact'),
        {
          startDir: '/',
          mode: 'save',
          defaultName: 'draft.md',
        },
      ), {
        readDir: (p: string) => sampleFileEntries(p),
        onFileSubmit: () => {},
      }),
    },
  });

  out.push({
    id: 'modal.request-user-input-overlay',
    title: 'RequestUserInputOverlay (modal)',
    group: 'modal',
    summary: 'Multi-question AskUser overlay body.',
    props: {
      questions: 3,
      chromeSpec: catalogModalDialogChrome('Ask user'),
    },
    view: {
      kind: 'view',
      view: buildDeclarativeCatalogView(
        buildRequestUserCatalogSpec(
          'Ask user',
          catalogModalDialogChrome('Ask user'),
          [
            question('scope', 'Scope of the change?').setOptions([
              option('Single file', 's'),
              option('Module (<10 files)', 'm'),
              option('Cross-cutting', 'l'),
            ]),
            question('test', 'Testing plan?').setInputType({ placeholder: 'e.g. add unit + smoke' }),
            question('risk', 'Risk call-outs?')
              .setInputType({ placeholder: 'Optional', initialValue: '' })
              .allowNotes(),
          ],
        ),
      ),
    },
  });

  return out;
}

// ─── Public entrypoints ─────────────────────────────────────────────

let CACHED_CATALOG: CatalogEntry[] | null = null;

function buildCatalogEntries(
  opts: {
    includeSidebarShellDemo?: boolean;
  } = {},
): CatalogEntry[] {
  return [
    ...buildUxEntries(opts),
    ...buildWidgetEntries(),
    ...buildModalEntries(),
  ];
}

/** Build every catalog entry once per process. Subsequent calls return
 *  the cached array so views keep their internal state (cursor, scroll,
 *  FileDialog.entries loaded from async readDir). */
export function getCatalog(): CatalogEntry[] {
  if (CACHED_CATALOG) return CACHED_CATALOG;
  const entries = buildCatalogEntries();
  CACHED_CATALOG = entries;
  return entries;
}

export function getCatalogForIulLab(): CatalogEntry[] {
  return buildCatalogEntries({ includeSidebarShellDemo: false });
}

/** Flattened list of groups in catalog order. */
export function catalogGroups(): CatalogGroupMeta[] {
  return CATALOG_GROUPS;
}

/** For tests — reset the cached catalog so subsequent calls rebuild. */
export function resetCatalogForTest(): void {
  CACHED_CATALOG = null;
}

/** Convenience — counts per group. Used by tests + inspect line. */
export function countsByGroup(): Record<CatalogGroup, number> {
  const catalog = getCatalog();
  const out: Record<CatalogGroup, number> = { ux: 0, widget: 0, modal: 0 };
  for (const e of catalog) out[e.group]++;
  return out;
}
