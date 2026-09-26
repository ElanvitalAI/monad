export const ACP_CHANNEL_BROWSER_COPY = {
  emptyResidentState: [
    'No ACP sessions yet.',
    'Live client/server/background activity will appear here.',
    'Saved ACP history will also appear here.',
    'Start or resume ACP work from the dashboard and return here to inspect it.',
  ].join('\n'),
  noBackgroundPreview: '(no output yet)',
  noLiveClientExcerpt: 'No live client excerpt is mirrored into the browser shell yet. Promote or focus the lane for the full room.',
  noLiveServerExcerpt: 'No live server excerpt is mirrored into the browser shell yet. Open the full ACP server room for the active stream.',
  noPersistedExcerpt: '(no persisted transcript excerpt)',
  noSessionNotes: 'No extra transcript is attached yet. Use this browser as a lane index before you jump into a live ACP room or background join flow.',
  previewSectionTitle: 'Preview',
  outputSectionTitle: 'Output excerpt',
  notesSectionTitle: 'Notes',
  summarySectionTitle: 'Summary',
  actionsSectionTitle: 'Next actions',
  liveClientNotes:
    'Client lanes keep their live room elsewhere. This shell is the fast index for choosing the right client session before you promote or join it.',
  liveServerNotes:
    'Server lanes represent ACP sessions where elanous is the agent side. Use this browser to inspect routing and activity before drilling into the full room.',
  backgroundNotes:
    'Background lanes preserve async ACP work without opening one VW per run. Preview output here before you join, resume, or inspect the full transcript.',
  historyNotes:
    'Persisted ACP lanes keep prior conversations available after the live room is gone. Review saved excerpts here before you resume, compare, or reopen the full room.',
  actionHints: {
    liveClient: [
      'Promote or focus this client lane when you want the full live room.',
      'Inspect active hops before spawning more downstream ACP work.',
    ].join('\n'),
    liveServer: [
      'Open the full server room when you need the live message stream.',
      'Use this lane to verify backend session routing before deeper inspection.',
    ].join('\n'),
    backgroundRunning: [
      'Stay here to watch preview output, or join when the partial output is enough.',
      'If the run looks wrong, cancel or inspect the backend session next.',
    ].join('\n'),
    backgroundWaiting: [
      'This lane is waiting for confirmation. Resume from the approval surface, then return here.',
      'Preview output stays available while the run is paused.',
    ].join('\n'),
    backgroundTerminal: [
      'Review the preview/output summary first, then join for the full transcript if needed.',
      'Use stop reason and error fields to decide whether to retry or archive the lane.',
    ].join('\n'),
    history: [
      'Review the saved transcript excerpt before resuming or reopening a room.',
      'Use this lane as context when comparing past ACP runs to current live activity.',
    ].join('\n'),
    generic: [
      'Use the rail as a fast ACP index before opening a full room.',
      'Switch lanes here, then promote or inspect the chosen session in its native surface.',
    ].join('\n'),
  },
  fields: {
    alive: 'Alive',
    created: 'Created',
    lastActivity: 'Last activity',
    historyRecency: 'Last seen (relative)',
    backend: 'Backend',
    backendSession: 'Backend session',
    activeHops: 'Active hops',
    state: 'State',
    origin: 'Origin',
    workspace: 'Workspace',
    stopReason: 'Stop reason',
    error: 'Error',
    laneType: 'Lane type',
    primaryAction: 'Primary action',
    actionStatus: 'Action status',
    title: 'Channel',
    historyTurns: 'History blocks',
    preview: 'Preview',
  },
  primaryActionLabels: {
    liveClient: 'Open live client room',
    liveServer: 'Open live server room',
    backgroundLive: 'Promote background lane to VW',
    backgroundTerminal: 'Join background transcript',
    history: 'Resume persisted ACP session',
    generic: 'Inspect ACP lane',
  },
} as const;
