import { describe, expect, test } from 'bun:test';
import { ACP_CHANNEL_BROWSER_COPY } from '../src/acp/channel-browser-copy.js';

describe('ACP channel browser copy catalog', () => {
  test('keeps browser notes and preview fallback canonical in one place', () => {
    expect(ACP_CHANNEL_BROWSER_COPY.noBackgroundPreview).toBe('(no output yet)');
    expect(ACP_CHANNEL_BROWSER_COPY.noPersistedExcerpt).toBe('(no persisted transcript excerpt)');
    expect(ACP_CHANNEL_BROWSER_COPY.liveClientNotes).toContain('client session');
    expect(ACP_CHANNEL_BROWSER_COPY.liveServerNotes).toContain('elanous is the agent side');
    expect(ACP_CHANNEL_BROWSER_COPY.backgroundNotes).toContain('async ACP work');
    expect(ACP_CHANNEL_BROWSER_COPY.historyNotes).toContain('prior conversations');
    expect(ACP_CHANNEL_BROWSER_COPY.previewSectionTitle).toBe('Preview');
    expect(ACP_CHANNEL_BROWSER_COPY.outputSectionTitle).toBe('Output excerpt');
    expect(ACP_CHANNEL_BROWSER_COPY.notesSectionTitle).toBe('Notes');
    expect(ACP_CHANNEL_BROWSER_COPY.summarySectionTitle).toBe('Summary');
    expect(ACP_CHANNEL_BROWSER_COPY.actionsSectionTitle).toBe('Next actions');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.activeHops).toBe('Active hops');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.historyTurns).toBe('History blocks');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.historyRecency).toBe('Last seen (relative)');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.workspace).toBe('Workspace');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.laneType).toBe('Lane type');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.primaryAction).toBe('Primary action');
    expect(ACP_CHANNEL_BROWSER_COPY.fields.actionStatus).toBe('Action status');
    expect(ACP_CHANNEL_BROWSER_COPY.actionHints.liveClient).toContain('full live room');
    expect(ACP_CHANNEL_BROWSER_COPY.actionHints.history).toContain('saved transcript excerpt');
    expect(ACP_CHANNEL_BROWSER_COPY.noLiveClientExcerpt).toContain('browser shell yet');
    expect(ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.history).toBe('Resume persisted ACP session');
  });
});
