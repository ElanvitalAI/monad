import { beforeEach, describe, expect, test } from 'bun:test';
import {
  catalogGroups,
  countsByGroup,
  getCatalog,
  resetCatalogForTest,
  setWidgetHostForCatalog,
  type CatalogEntry,
} from '../src/playground/catalog.js';
import { Printer } from '../src/ui/printer.js';
import type { Size } from '../src/ui/view.js';

beforeEach(() => {
  setWidgetHostForCatalog(null);
  resetCatalogForTest();
});

function renderPreview(entry: CatalogEntry, size: Size = { width: 40, height: 10 }): string[] {
  const p = Printer.create({ width: size.width, height: size.height, focused: false });
  if (entry.view.kind === 'view') {
    const view = entry.view.view;
    if (typeof (view as { layout?: (s: Size) => void }).layout === 'function') {
      (view as { layout: (s: Size) => void }).layout(size);
    }
    view.draw(p);
  } else {
    const lines = entry.view.def.render(entry.view.state, {
      width: size.width,
      height: size.height,
      focused: false,
      originRow: 1,
      originCol: 1,
    } as never, entry.view.character);
    for (let y = 0; y < Math.min(lines.length, size.height); y++) p.text(0, y, lines[y] ?? '');
  }
  return p.lines();
}

describe('VP6 — playground catalog', () => {
  test('exposes 3 groups in catalog order', () => {
    const groups = catalogGroups();
    expect(groups.map(g => g.id)).toEqual(['ux', 'widget', 'modal']);
  });

  test('UX group has the full roster of LC view widgets', () => {
    const catalog = getCatalog();
    const uxIds = catalog.filter(e => e.group === 'ux').map(e => e.id);
    // Must include at least these key components.
    for (const id of [
      'ux.button', 'ux.progress-bar', 'ux.tooltip',
      'ux.declarative-telemetry-lab', 'ux.declarative-hover-lab',
      'ux.accordion', 'ux.tabs', 'ux.text-area', 'ux.tree-view',
      'ux.select-view', 'ux.combo-box', 'ux.list-view', 'ux.edit-view',
      'ux.dialog', 'ux.file-dialog', 'ux.permission-prompt',
      'ux.slash-menu', 'ux.context-menu', 'ux.draggable-list',
      'ux.toast-stack', 'ux.title-bar', 'ux.request-user-input-overlay',
      'ux.intake-review',
    ]) {
      expect(uxIds).toContain(id);
    }
  });

  test('Modal group covers the dashboard\'s modal bodies', () => {
    const catalog = getCatalog();
    const modalIds = catalog.filter(e => e.group === 'modal').map(e => e.id);
    for (const id of [
      'modal.dialog-confirm', 'modal.dialog-approval',
      'modal.declarative-approval-lab',
      'modal.permission-prompt', 'modal.slash-menu', 'modal.context-menu',
      'modal.file-dialog', 'modal.request-user-input-overlay',
    ]) {
      expect(modalIds).toContain(id);
    }
  });

  test('Widget group is empty until a WidgetHost is wired', () => {
    const catalog = getCatalog();
    expect(catalog.filter(e => e.group === 'widget').length).toBe(0);
  });

  test('Every UX + Modal entry renders without throwing at 40×10', () => {
    const catalog = getCatalog();
    for (const entry of catalog.filter(e => e.group !== 'widget')) {
      expect(() => renderPreview(entry)).not.toThrow();
    }
  });

  test('catalog showcase entries expose declarative chrome titles in render output', () => {
    const catalog = getCatalog();
    const tooltip = catalog.find(e => e.id === 'ux.tooltip');
    const combo = catalog.find(e => e.id === 'ux.combo-box');
    const permission = catalog.find(e => e.id === 'ux.permission-prompt');
    const slash = catalog.find(e => e.id === 'ux.slash-menu');
    const file = catalog.find(e => e.id === 'modal.file-dialog');
    const ask = catalog.find(e => e.id === 'ux.request-user-input-overlay');
    const intake = catalog.find(e => e.id === 'ux.intake-review');
    const telemetryLab = catalog.find(e => e.id === 'ux.declarative-telemetry-lab');
    const approvalLab = catalog.find(e => e.id === 'modal.declarative-approval-lab');
    expect(tooltip).toBeTruthy();
    expect(combo).toBeTruthy();
    expect(permission).toBeTruthy();
    expect(slash).toBeTruthy();
    expect(file).toBeTruthy();
    expect(ask).toBeTruthy();
    expect(intake).toBeTruthy();
    expect(telemetryLab).toBeTruthy();
    expect(approvalLab).toBeTruthy();

    const tooltipText = renderPreview(tooltip!).join('\n');
    const comboText = renderPreview(combo!).join('\n');
    const permissionText = renderPreview(permission!).join('\n');
    const slashText = renderPreview(slash!).join('\n');
    const fileText = renderPreview(file!).join('\n');
    const askText = renderPreview(ask!).join('\n');
    const intakeText = renderPreview(intake!).join('\n');
    const telemetryLabText = renderPreview(telemetryLab!).join('\n');
    const approvalLabText = renderPreview(approvalLab!).join('\n');

    expect(tooltipText).toContain('Declarative hint');
    expect(comboText).toContain('Declarative combo');
    expect(permissionText).toContain('Declarative permission');
    expect(slashText).toContain('Declarative commands');
    expect(fileText).toContain('Save artifact');
    expect(askText).toContain('Declarative ask-user');
    expect(intakeText).toContain('Review intake');
    expect(intakeText).toContain('Apply now');
    expect(telemetryLabText).toContain('Telemetry');
    expect(telemetryLabText).toContain('materialized:');
    expect(approvalLabText).toContain('Approve patch?');
  });

  test('countsByGroup reflects catalog composition', () => {
    const counts = countsByGroup();
    expect(counts.ux).toBeGreaterThan(15);
    expect(counts.modal).toBeGreaterThan(5);
    expect(counts.widget).toBe(0);
  });

  test('Every entry carries an id + title + summary + props', () => {
    const catalog = getCatalog();
    for (const e of catalog) {
      expect(e.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
      expect(typeof e.title).toBe('string');
      expect(e.title.length).toBeGreaterThan(0);
      expect(typeof e.summary).toBe('string');
      expect(e.props).toBeDefined();
      expect(typeof e.props).toBe('object');
    }
  });

  test('resetCatalogForTest + setWidgetHostForCatalog(null) yields the same non-widget baseline', () => {
    const a = getCatalog().filter(e => e.group !== 'widget').length;
    resetCatalogForTest();
    const b = getCatalog().filter(e => e.group !== 'widget').length;
    expect(a).toBe(b);
  });
});
