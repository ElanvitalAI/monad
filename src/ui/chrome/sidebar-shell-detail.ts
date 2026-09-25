import { C } from '../../tui.js';
import { paintPair, pair } from '../../theme/tokens.js';
import { TextArea } from '../widgets/text-area.js';
import type { View } from '../view.js';

export interface SidebarShellDetailField {
  label: string;
  value: string | null | undefined;
}

export interface SidebarShellDetailSection {
  title: string;
  body: string;
}

export function buildSidebarShellPreviewText(opts: {
  title: string;
  subtitle?: string;
  tail?: string;
}): string {
  const lines = [opts.title];
  if (opts.subtitle) {
    lines.push('');
    lines.push(opts.subtitle);
  }
  if (opts.tail) {
    lines.push('');
    lines.push(opts.tail);
  }
  return lines.join('\n');
}

export function buildSidebarShellDetailText(opts: {
  title: string;
  subtitle?: string;
  fields?: readonly SidebarShellDetailField[];
  sections?: readonly SidebarShellDetailSection[];
}): string {
  const lines: string[] = [detailTitlePainter(opts.title)];
  if (opts.subtitle) {
    lines.push('');
    lines.push(C.muted(opts.subtitle));
  }
  const filteredFields = (opts.fields ?? []).filter((field) => field.value !== undefined && field.value !== null && String(field.value).length > 0);
  if (filteredFields.length > 0) {
    const labelWidth = filteredFields.reduce((max, field) => Math.max(max, field.label.length), 0);
    lines.push('');
    for (const field of filteredFields) {
      lines.push(`${C.muted(field.label.padEnd(labelWidth))}  ${String(field.value)}`);
    }
  }
  for (const section of opts.sections ?? []) {
    lines.push('');
    lines.push(detailSectionPainter(`── ${section.title} ──`));
    lines.push('');
    lines.push(section.body);
  }
  return lines.join('\n');
}

function detailTitlePainter(text: string): string {
  return paintPair(pair('#324c62', { bg: '#edf4fa', bold: true }))(` ${text} `);
}

function detailSectionPainter(text: string): string {
  return paintPair(pair('#5d5870', { bg: '#f1edf7', bold: true }))(` ${text} `);
}

export function createSidebarShellNoteView(opts: {
  title: string;
  body: string;
  subtitle?: string;
  sections?: readonly SidebarShellDetailSection[];
}): View {
  return new TextArea({
    text: buildSidebarShellDetailText({
      title: opts.title,
      subtitle: opts.subtitle,
      sections: [{ title: 'Notes', body: opts.body }, ...(opts.sections ?? [])],
    }),
    readOnly: true,
    wrap: true,
  });
}
