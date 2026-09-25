import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Attachment } from '../context.js';
import { scratchImageSize } from '../views/ui-mode.js';

const renderImagePreview = mock(async (_absPath: string, _opts: { cols: number; rows: number }) => null as string[] | null);

mock.module('../image/preview.js', () => ({
  renderImagePreview,
}));

import { createRichScratchViewers } from './rich-scratch-viewers.js';

function attachment(partial: Partial<Attachment> & Pick<Attachment, 'kind' | 'filename' | 'sourcePath'>): Attachment {
  return {
    id: 1,
    token: '[Text #1]',
    sizeBytes: 0,
    mtime: 0,
    pastedAt: 0,
    loaded: false,
    ...partial,
  };
}

describe('createRichScratchViewers', () => {
  afterEach(() => {
    renderImagePreview.mockReset();
    renderImagePreview.mockImplementation(async () => null);
  });

  it('setScratchImage writes the chafa-failure marker when preview is empty', async () => {
    const calls: Array<{ title: string; lines: string[] }> = [];
    const { setScratchImage } = createRichScratchViewers({
      setDetailViewer: (title, lines) => { calls.push({ title, lines }); },
      termSize: () => ({ rows: 40, cols: 120 }),
      fmtBytes: (n) => `${n}B`,
    });

    await setScratchImage('/no/such/image.png', 'shot.png');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe('shot.png');
    expect(calls[0]!.lines.join('\n')).toContain('install chafa to preview');
  });

  it('setScratchImage sizes the preview with scratchImageSize(rows, cols)', async () => {
    const expected = scratchImageSize(40, 120);
    renderImagePreview.mockImplementation(async (_absPath, opts) => [`preview ${opts.cols}x${opts.rows}`]);
    const calls: Array<{ title: string; lines: string[] }> = [];
    const { setScratchImage } = createRichScratchViewers({
      setDetailViewer: (title, lines) => { calls.push({ title, lines }); },
      termSize: () => ({ rows: 40, cols: 120 }),
      fmtBytes: (n) => `${n}B`,
    });

    await setScratchImage('/tmp/ok.png', 'ok.png');

    expect(renderImagePreview).toHaveBeenCalledWith('/tmp/ok.png', { cols: expected.cols, rows: expected.rows });
    expect(calls).toEqual([{ title: 'ok.png', lines: [`preview ${expected.cols}x${expected.rows}`] }]);
  });

  it('setScratchFile writes the extracted-body marker for pdf/docx/xlsx', () => {
    const calls: Array<{ title: string; lines: string[] }> = [];
    const { setScratchFile } = createRichScratchViewers({
      setDetailViewer: (title, lines) => { calls.push({ title, lines }); },
      termSize: () => ({ rows: 24, cols: 80 }),
      fmtBytes: (n) => `${n}bytes`,
    });

    setScratchFile(attachment({
      kind: 'pdf',
      filename: 'doc.pdf',
      sourcePath: '/tmp/doc.pdf',
      sizeBytes: 4096,
      token: '[PDF #1]',
    }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe('doc.pdf');
    const body = calls[0]!.lines.join('\n');
    expect(body).toContain('4096bytes');
    expect(body).toContain('Body extracted at submit');
  });

  it('setScratchFile previews a text attachment with line numbers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rich-scratch-'));
    const sourcePath = join(dir, 'note.md');
    writeFileSync(sourcePath, 'hello\nworld\n');
    const calls: Array<{ title: string; lines: string[] }> = [];
    const { setScratchFile } = createRichScratchViewers({
      setDetailViewer: (title, lines) => { calls.push({ title, lines }); },
      termSize: () => ({ rows: 24, cols: 80 }),
      fmtBytes: (n) => `${n}B`,
    });

    setScratchFile(attachment({
      kind: 'md',
      filename: 'note.md',
      sourcePath,
      token: '[Md #1]',
    }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe('note.md');
    expect(calls[0]!.lines.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]!.lines[0]).toContain('1');
    expect(calls[0]!.lines[0]).toContain('hello');
    expect(calls[0]!.lines[1]).toContain('world');
  });
});
