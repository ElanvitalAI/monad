import { DEFAULT_REGISTRY_THEME, getTheme, listThemes } from '../themes/index.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { KeyEvent } from '../plugins/core/types.js';
import type { Printer } from '../ui/printer.js';
import { LinearLayout } from '../ui/layout/linear.js';
import { BoxView, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import { SelectView, type SelectOption } from '../ui/widgets/select-view.js';
import { Tabs } from '../ui/widgets/tabs.js';
import { TextArea } from '../ui/widgets/text-area.js';
import { Dialog } from '../ui/widgets/dialog.js';
import { buildSidebarShellDetailText } from '../ui/chrome/sidebar-shell-detail.js';

export interface IulThemePreviewControl {
  getActiveThemeName: () => string;
  previewTheme: (name: string) => void;
  revertPreview: () => void;
  commitTheme: (name: string) => void;
}

export interface ThemeLabLaneState {
  baselineTheme: string;
  previewTheme: string;
  selectedTheme: string;
  previewActive: boolean;
  committedTheme: string;
}

export function createThemeLabLaneState(
  baselineTheme: string,
): ThemeLabLaneState {
  return {
    baselineTheme,
    previewTheme: baselineTheme,
    selectedTheme: baselineTheme,
    previewActive: false,
    committedTheme: baselineTheme,
  };
}

export function createThemeLabLaneView(opts: {
  footerHint: string;
  state: ThemeLabLaneState;
  themePreviewControl?: IulThemePreviewControl;
}): View {
  return new ThemeLabLaneView(opts);
}

class ThemeLabLaneView implements View {
  private root: View = new TextArea({ text: '' });
  private layoutSize: Size = { width: 80, height: 24 };
  private readonly themeOptions = listThemes();
  private cursor = 0;

  constructor(private readonly spec: {
    footerHint: string;
    state: ThemeLabLaneState;
    themePreviewControl?: IulThemePreviewControl;
  }) {
    const initialIdx = this.themeOptions.findIndex((theme) => theme.name === spec.state.selectedTheme);
    this.cursor = Math.max(0, initialIdx);
    this.rebuild();
  }

  draw(p: Printer): void {
    this.root.draw(p);
  }

  onEvent(ev: KeyEvent): EventResult {
    return this.root.onEvent(ev);
  }

  layout(size: Size): void {
    this.layoutSize = size;
    this.root.layout(size);
  }

  requiredSize(constraint: Size): Size {
    return this.root.requiredSize(constraint);
  }

  takeFocus(source?: FocusSource): boolean {
    return this.root.takeFocus(source);
  }

  private rebuild(): void {
    const themed = this.resolveTheme(this.spec.state.previewTheme);
    const selector = this.buildThemeSelector(themed);
    const showcase = this.buildShowcase(themed);
    const root = LinearLayout.horizontal(
      {
        view: new BoxView(selector, {
          border: true,
          title: 'Theme preview',
          titleAlign: 'center',
        }),
        size: Math.max(30, Math.min(38, Math.floor(this.layoutSize.width * 0.35))),
      },
      {
        view: showcase,
      },
    );
    root.layout(this.layoutSize);
    root.takeFocus('front');
    this.root = root;
  }

  private buildThemeSelector(theme: ThemeTokens): View {
    const options = this.themeOptions.map<SelectOption<string>>((entry) => ({
      value: entry.name,
      label: entry.name,
      description: [
        entry.isDark ? 'dark' : 'light',
        entry.isPastel ? 'pastel' : 'standard',
      ].join(' · '),
    }));
    return new SelectView<string>({
      title: 'Theme Lab',
      searchable: true,
      browseMode: true,
      visibleRows: 9,
      options,
      cursor: () => this.cursor,
      onCursorChange: (next) => {
        this.cursor = next;
        const name = options[next]?.value;
        if (!name) return;
        this.previewTheme(name);
      },
      footerHint: this.spec.footerHint,
      theme,
      preview: (focused) => buildSidebarShellDetailText({
        title: focused.label,
        subtitle: focused.description ?? '',
        fields: [
          { label: 'Live shell', value: this.spec.themePreviewControl?.getActiveThemeName() ?? this.spec.state.previewTheme },
          { label: 'Baseline', value: this.spec.state.baselineTheme },
          { label: 'Preview', value: this.spec.state.previewActive ? 'active' : 'idle' },
        ],
        sections: [
          {
            title: 'How to use',
            body: [
              'Move the cursor to repaint the whole shell immediately.',
              'Press Enter to keep the current theme.',
              'Press Esc to revert to the baseline theme.',
            ].join('\n'),
          },
        ],
      }),
      onSubmit: (picked) => {
        const name = Array.isArray(picked) ? String(picked[0]) : String(picked);
        this.commitTheme(name);
      },
      onCancel: () => {
        this.revertTheme();
      },
      onChange: (value) => {
        this.spec.state.selectedTheme = String(value);
      },
    });
  }

  private buildShowcase(theme: ThemeTokens): View {
    const summary = new BoxView(new TextArea({
      readOnly: true,
      wrap: true,
      theme,
      text: buildSidebarShellDetailText({
        title: 'Live widget showcase',
        subtitle: 'This surface is intentionally freeform: pickers, tabs, dialogs, and note panels all repaint together.',
        fields: [
          { label: 'Selected', value: this.spec.state.selectedTheme },
          { label: 'Baseline', value: this.spec.state.baselineTheme },
          { label: 'Live shell', value: this.spec.themePreviewControl?.getActiveThemeName() ?? this.spec.state.previewTheme },
          { label: 'Status', value: this.spec.state.previewActive ? 'live preview active' : 'committed / baseline' },
        ],
        sections: [
          {
            title: 'Observe',
            body: 'Watch row selection, dialog accents, tab bars, and note headings change together. The goal is not generation but instant whole-surface theme evaluation.',
          },
        ],
      }),
    }), { border: true, title: 'Status', titleAlign: 'center' });

    const tabs = new BoxView(new Tabs({
      theme,
      tabs: [
        {
          title: 'Menu',
          content: new SelectView<string>({
            title: 'Surface menu',
            searchable: false,
            browseMode: true,
            visibleRows: 4,
            theme,
            footerHint: '',
            options: [
              { value: 'picker', label: 'Picker', description: 'Compact selection chrome' },
              { value: 'dialog', label: 'Dialog', description: 'Confirm / approval shell' },
              { value: 'pane', label: 'Pane', description: 'Dense work surface' },
              { value: 'popup', label: 'Popup', description: 'Transient overlay tier' },
            ],
            onSubmit: () => {},
            onCancel: () => {},
          }),
        },
        {
          title: 'Notes',
          content: new TextArea({
            readOnly: true,
            wrap: true,
            theme,
            text: 'Use this pane to judge neutral text, muted labels, and long-form readability under the selected theme.',
          }),
        },
      ],
    }), { border: true, title: 'Tabs', titleAlign: 'center' });

    const lower = LinearLayout.horizontal(
      {
        view: new Dialog({
          title: 'Apply this theme?',
          body: 'Confirm, cancel, and bordered actions should stay readable on both dark and pastel presets.',
          buttons: [
            { label: 'Keep', value: 'keep', shortcut: 'k' },
            { label: 'Cancel', value: 'cancel', shortcut: 'c' },
          ],
          onSubmit: () => {},
          onCancel: () => {},
          theme,
        }),
      },
      {
        view: new BoxView(new TextArea({
          readOnly: true,
          wrap: true,
          theme,
          text: [
            'Badge cues live in the rail, but this note panel should also feel stable.',
            '',
            'Good themes keep:',
            '- active selection readable',
            '- muted metadata calm',
            '- dialog emphasis visible without screaming',
          ].join('\n'),
        }), { border: true, title: 'Notes', titleAlign: 'center' }),
      },
    );

    const right = LinearLayout.vertical(
      { view: summary, size: 8 },
      { view: tabs, size: 8 },
      { view: lower },
    );

    return right;
  }

  private previewTheme(name: string): void {
    this.spec.state.selectedTheme = name;
    this.spec.state.previewTheme = name;
    this.spec.state.previewActive = name !== this.spec.state.baselineTheme;
    this.spec.themePreviewControl?.previewTheme(name);
    this.rebuild();
  }

  private commitTheme(name: string): void {
    this.spec.state.selectedTheme = name;
    this.spec.state.previewTheme = name;
    this.spec.state.baselineTheme = name;
    this.spec.state.committedTheme = name;
    this.spec.state.previewActive = false;
    this.spec.themePreviewControl?.commitTheme(name);
    this.rebuild();
  }

  private revertTheme(): void {
    this.spec.state.selectedTheme = this.spec.state.baselineTheme;
    this.spec.state.previewTheme = this.spec.state.baselineTheme;
    this.spec.state.previewActive = false;
    const idx = this.themeOptions.findIndex((theme) => theme.name === this.spec.state.baselineTheme);
    this.cursor = Math.max(0, idx);
    this.spec.themePreviewControl?.revertPreview();
    this.rebuild();
  }

  private resolveTheme(name: string): ThemeTokens {
    return getTheme(name) ?? DEFAULT_REGISTRY_THEME;
  }
}
