import { describe, expect, test } from 'bun:test';
import {
  describeForScreenReader,
  describeSpec,
  describeNotificationEvent,
  notificationLevelOf,
  notificationLevelLabel,
} from '../src/expression/index.js';
import { getMessages } from '../src/expression/i18n/index.js';
import type {
  ProgressSpec,
  TableSpec,
  MarkdownSpec,
  ModalSpec,
  PickerSpec,
  StatusModuleSpec,
  StepSpec,
  InteractiveModalSpec,
} from '../src/expression/index.js';

describe('expression/a11y · describeForScreenReader (en)', () => {
  test('progress: percent + optional label', () => {
    const spec: ProgressSpec = { kind: 'progress', value: 0.42 };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe('Progress: 42 percent.');

    const labeled: ProgressSpec = { kind: 'progress', value: 0.5, label: 'Build step' };
    expect(describeForScreenReader(labeled, { locale: 'en' })).toBe(
      'Progress: 50 percent. Build step',
    );
  });

  test('progress clamps out-of-range values', () => {
    const high: ProgressSpec = { kind: 'progress', value: 5 };
    expect(describeForScreenReader(high, { locale: 'en' })).toBe('Progress: 100 percent.');

    const low: ProgressSpec = { kind: 'progress', value: -1 };
    expect(describeForScreenReader(low, { locale: 'en' })).toBe('Progress: 0 percent.');

    const nan: ProgressSpec = { kind: 'progress', value: NaN };
    expect(describeForScreenReader(nan, { locale: 'en' })).toBe('Progress: 0 percent.');
  });

  test('spinner: label or fallback "Loading…"', () => {
    expect(
      describeForScreenReader({ kind: 'spinner', label: 'fetching' }, { locale: 'en' }),
    ).toBe('Loading: fetching');
    expect(describeForScreenReader({ kind: 'spinner' }, { locale: 'en' })).toContain('Loading');
  });

  test('table: cols + rows announced; title prefix when present', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }],
    };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe(
      'Table with 2 columns and 3 rows.',
    );

    const titled: TableSpec = { ...spec, title: 'Report' };
    expect(describeForScreenReader(titled, { locale: 'en' })).toBe(
      'Report. Table with 2 columns and 3 rows.',
    );
  });

  test('markdown: heading-only summary stripped of decoration', () => {
    const spec: MarkdownSpec = {
      kind: 'markdown',
      body: '# Welcome\n\nText.\n\n## **Sub** *fancy*\n\nbody',
    };
    const out = describeForScreenReader(spec, { locale: 'en' });
    expect(out).toContain('Welcome');
    expect(out).toContain('Sub fancy');
    expect(out).not.toContain('**');
    expect(out).not.toContain('*fancy*');
  });

  test('markdown: link label only (no url) in heading summary', () => {
    const spec: MarkdownSpec = {
      kind: 'markdown',
      body: '# See [docs](https://example.com)',
    };
    const out = describeForScreenReader(spec, { locale: 'en' });
    expect(out).toContain('See docs');
    expect(out).not.toContain('https://');
  });

  test('markdown: empty body falls back to label', () => {
    const spec: MarkdownSpec = { kind: 'markdown', body: '' };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe('Markdown content.');
  });

  test('markdown: title only', () => {
    const spec: MarkdownSpec = { kind: 'markdown', title: 'Help', body: '' };
    const out = describeForScreenReader(spec, { locale: 'en' });
    expect(out).toContain('Help');
    expect(out).toContain('Markdown content.');
  });

  test('modal: dialog + title + body', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'Confirm',
      body: 'Are you sure?',
    };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe(
      'Dialog opened. Confirm. Are you sure?',
    );
  });

  test('picker: announces option count + optional title', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      items: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe('Choose one of 3 options.');

    const titled: PickerSpec = { ...spec, title: 'Provider' };
    expect(describeForScreenReader(titled, { locale: 'en' })).toBe(
      'Provider. Choose one of 3 options.',
    );
  });

  test('status-module: text only', () => {
    const spec: StatusModuleSpec = { kind: 'status-module', id: 's', text: 'Online' };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe('Online');
  });

  test('step: title + optional progress', () => {
    const spec: StepSpec = {
      kind: 'step',
      id: 's',
      title: 'Setup providers',
      fields: [],
      progress: { index: 2, total: 5 },
    };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe(
      'Step 2 of 5. Setup providers.',
    );
  });

  test('step without progress falls back to plain title', () => {
    const spec: StepSpec = { kind: 'step', id: 's', title: 'Plain', fields: [] };
    expect(describeForScreenReader(spec, { locale: 'en' })).toBe('Plain.');
  });

  test('interactive-modal: wizard with step count', () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'w',
      title: 'Onboarding',
      steps: [
        { kind: 'text', id: 'a', label: 'A' },
        { kind: 'text', id: 'b', label: 'B' },
        { kind: 'text', id: 'c', label: 'C' },
      ],
    };
    const out = describeForScreenReader(spec, { locale: 'en' });
    expect(out).toContain('Onboarding');
    expect(out).toContain('Wizard');
    expect(out).toContain('3');
  });
});

describe('expression/a11y · describeForScreenReader (ko)', () => {
  test('progress speaks Korean', () => {
    expect(
      describeForScreenReader({ kind: 'progress', value: 0.5 }, { locale: 'ko' }),
    ).toBe('진행률 50퍼센트.');
  });

  test('table speaks Korean column/row count', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: 1 }, { a: 2 }],
    };
    expect(describeForScreenReader(spec, { locale: 'ko' })).toBe(
      '1개 열과 2개 행을 가진 표.',
    );
  });

  test('picker speaks Korean count', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      items: [{ id: 'a', label: 'A' }],
    };
    expect(describeForScreenReader(spec, { locale: 'ko' })).toBe('1개 옵션 중 하나를 선택하세요.');
  });

  test('modal speaks Korean dialog', () => {
    const spec: ModalSpec = { kind: 'modal', id: 'm', title: '확인', body: '정말요?' };
    expect(describeForScreenReader(spec, { locale: 'ko' })).toBe(
      '대화 상자 열림. 확인. 정말요?',
    );
  });
});

describe('expression/a11y · describeForScreenReader (ja)', () => {
  test('progress speaks Japanese', () => {
    expect(
      describeForScreenReader({ kind: 'progress', value: 0.5 }, { locale: 'ja' }),
    ).toBe('進捗 50 パーセント。');
  });

  test('table speaks Japanese column/row count', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: 1 }, { a: 2 }],
    };
    expect(describeForScreenReader(spec, { locale: 'ja' })).toBe('1 列 2 行の表。');
  });

  test('modal speaks Japanese dialog', () => {
    const spec: ModalSpec = { kind: 'modal', id: 'm', title: '確認', body: '本当に?' };
    expect(describeForScreenReader(spec, { locale: 'ja' })).toBe(
      'ダイアログを開きました。 確認. 本当に?',
    );
  });
});

describe('expression/a11y · describeForScreenReader (zh)', () => {
  test('progress speaks Simplified Chinese', () => {
    expect(
      describeForScreenReader({ kind: 'progress', value: 0.5 }, { locale: 'zh' }),
    ).toBe('进度 50 %。');
  });

  test('picker speaks Chinese count', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    };
    expect(describeForScreenReader(spec, { locale: 'zh' })).toBe(
      '从 2 个选项中选择一个。',
    );
  });

  test('modal speaks Chinese dialog', () => {
    const spec: ModalSpec = { kind: 'modal', id: 'm', title: '确认', body: '真的吗?' };
    expect(describeForScreenReader(spec, { locale: 'zh' })).toBe(
      '对话框已打开。 确认. 真的吗?',
    );
  });
});

describe('expression/a11y · output is plain text', () => {
  test('contains no ANSI escapes', () => {
    const cases = [
      describeForScreenReader({ kind: 'progress', value: 0.5 }, { locale: 'en' }),
      describeForScreenReader({ kind: 'spinner', label: 'x' }, { locale: 'en' }),
      describeForScreenReader(
        { kind: 'markdown', body: '# **Bold** title with `code`' },
        { locale: 'en' },
      ),
      describeForScreenReader(
        {
          kind: 'modal',
          id: 'm',
          title: 'T',
          body: 'B',
        },
        { locale: 'en' },
      ),
    ];
    for (const out of cases) {
      expect(out).not.toContain('\x1b[');
    }
  });
});

describe('expression/a11y · describeSpec aliases describeForScreenReader', () => {
  test('produces the same string for the same spec', () => {
    const spec: ProgressSpec = { kind: 'progress', value: 0.3 };
    expect(describeSpec(spec, { locale: 'en' })).toBe(
      describeForScreenReader(spec, { locale: 'en' }),
    );
  });
});

// ── Pick A PR-S5: describeNotificationEvent + level mapping ─────────

describe('expression/a11y · notificationLevelOf', () => {
  test('error / escalation → "error"', () => {
    expect(notificationLevelOf('error')).toBe('error');
    expect(notificationLevelOf('escalation')).toBe('error');
  });

  test('hitl → "warning"', () => {
    expect(notificationLevelOf('hitl')).toBe('warning');
  });

  test('status / osc / exit / block / agent-done → "info"', () => {
    expect(notificationLevelOf('status')).toBe('info');
    expect(notificationLevelOf('osc')).toBe('info');
    expect(notificationLevelOf('exit')).toBe('info');
    expect(notificationLevelOf('block')).toBe('info');
    expect(notificationLevelOf('agent-done')).toBe('info');
  });

  test('unknown kind → "info" fallback', () => {
    expect(notificationLevelOf('totally-fake-kind')).toBe('info');
  });
});

describe('expression/a11y · notificationLevelLabel (4-way locale)', () => {
  test('en bundle resolves all 3 levels', () => {
    const m = getMessages('en');
    expect(notificationLevelLabel('error', m)).toBe('error');
    expect(notificationLevelLabel('hitl', m)).toBe('warning');
    expect(notificationLevelLabel('status', m)).toBe('info');
  });

  test('ko bundle resolves all 3 levels', () => {
    const m = getMessages('ko');
    expect(notificationLevelLabel('error', m)).toBe('오류');
    expect(notificationLevelLabel('hitl', m)).toBe('경고');
    expect(notificationLevelLabel('block', m)).toBe('알림');
  });

  test('ja bundle resolves all 3 levels', () => {
    const m = getMessages('ja');
    expect(notificationLevelLabel('escalation', m)).toBe('エラー');
    expect(notificationLevelLabel('hitl', m)).toBe('警告');
    expect(notificationLevelLabel('status', m)).toBe('お知らせ');
  });

  test('zh bundle resolves all 3 levels', () => {
    const m = getMessages('zh');
    expect(notificationLevelLabel('error', m)).toBe('错误');
    expect(notificationLevelLabel('hitl', m)).toBe('警告');
    expect(notificationLevelLabel('agent-done', m)).toBe('通知');
  });
});

describe('expression/a11y · describeNotificationEvent', () => {
  const baseEvent = {
    sessionId: 'term:1',
    ts: new Date('2026-04-28T12:34:56.000').getTime(),
    kind: 'error',
    title: 'parse error',
  } as const;

  test('produces "<sessionId> · <time> · <kindLabel> · <title>" (en)', () => {
    const out = describeNotificationEvent(baseEvent, { locale: 'en' });
    expect(out).toContain('term:1');
    expect(out).toContain('error');
    expect(out).toContain('parse error');
    // Default fmtTime uses local clock fields — assert structure not exact.
    expect(out.split(' · ').length).toBe(4);
  });

  test('appends body when present', () => {
    const out = describeNotificationEvent(
      { ...baseEvent, body: 'unexpected EOF' },
      { locale: 'en' },
    );
    expect(out).toContain('unexpected EOF');
    expect(out.split(' · ').length).toBe(5);
  });

  test('locale variants produce different kind words (4-way)', () => {
    const en = describeNotificationEvent(baseEvent, { locale: 'en' });
    const ko = describeNotificationEvent(baseEvent, { locale: 'ko' });
    const ja = describeNotificationEvent(baseEvent, { locale: 'ja' });
    const zh = describeNotificationEvent(baseEvent, { locale: 'zh' });
    expect(en).toContain('error');
    expect(ko).toContain('오류');
    expect(ja).toContain('エラー');
    expect(zh).toContain('错误');
  });

  test('localizeKind: false → emits raw kind string', () => {
    const out = describeNotificationEvent(baseEvent, {
      locale: 'ko',
      localizeKind: false,
    });
    expect(out).toContain('error');
    expect(out).not.toContain('오류');
  });

  test('custom fmtTime override', () => {
    const out = describeNotificationEvent(baseEvent, {
      locale: 'en',
      fmtTime: () => 'noon',
    });
    expect(out).toContain('noon');
  });

  test('zero-ANSI utterance', () => {
    const out = describeNotificationEvent(
      { ...baseEvent, body: 'with body' },
      { locale: 'en' },
    );
    expect(out).not.toContain('\x1b[');
    expect(out).not.toMatch(/[\x00-\x1f]/);
  });
});
