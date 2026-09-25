'use client';

// M2-2b-v2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// TTS Voice ID per-context picker with ElevenLabs library browser.
//
// Builds on the M2-2b MVP text-input card. Adds:
//   - Search box that filters the daemon-provided voice library
//   - Voice catalog row with metadata (accent · gender · category)
//   - 1-click preview (▶) playing previewUrl via HTML5 audio
//   - Recently-used voices shortcut (top 5 across all contexts)
//   - "Configure API key" hint when daemon reports configured:false
//
// Per-context mapping (default · chat · digest · alert · discord) is
// unchanged from M2-2b — each context row now shows the chosen voice
// as a name+badge (instead of raw id) when the library is loaded.

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import {
  fetchVoiceLibrary,
  filterVoices,
  loadRecentVoiceIds,
  rememberRecentVoiceId,
  type VoiceLibrary,
  type VoiceLibraryEntry,
} from '@/lib/elevenlabs-voices';
import {
  pushTtsVoiceMappingToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
  type TtsVoiceMappingPatch,
} from '@/lib/model-tier-sync';

interface ContextRow {
  key: 'default' | 'chat' | 'digest' | 'alert' | 'discord';
  label: string;
  hint: string;
}

const CONTEXT_ROWS: readonly ContextRow[] = [
  { key: 'default', label: 'Default',       hint: 'Fallback when a specific context isn\'t set' },
  { key: 'chat',    label: 'Chat reply',    hint: 'Used by the PWA / TUI chat surface' },
  { key: 'digest',  label: 'Morning digest', hint: 'Daily summary read-back (P2-D7)' },
  { key: 'alert',   label: 'Push alerts',   hint: 'Urgency-driven voice for push notifications' },
  { key: 'discord', label: 'Discord bot',   hint: 'X9 Discord voice channel + DM voice replies' },
] as const;

type Mapping = Partial<Record<ContextRow['key'], string>>;

const STORAGE_KEY = 'monad.tts-voice-map';

function loadLocalMapping(): Mapping {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Mapping;
    const out: Mapping = {};
    for (const row of CONTEXT_ROWS) {
      const v = parsed[row.key];
      if (typeof v === 'string' && v.trim().length > 0) out[row.key] = v.trim();
    }
    return out;
  } catch { return {}; }
}

function saveLocalMapping(map: Mapping): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); }
  catch { /* quota / private mode */ }
}

function clearLocalMapping(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { /* ignore */ }
}

function describeVoice(v: VoiceLibraryEntry): string {
  const tags = [v.gender, v.accent, v.category].filter(Boolean).join(' · ');
  return tags || 'voice';
}

export function TtsVoiceIdPickerCard(): React.ReactNode {
  const { config } = useDaemon();
  const httpCfg: DaemonHttpConfig = useMemo(() => ({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
  }), [config.baseUrl, config.token]);

  const [mapping, setMapping] = useState<Mapping>(loadLocalMapping);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  // Library state — populated from daemon. Null = not yet fetched
  // (or PWA is offline / daemon unreachable).
  const [library, setLibrary] = useState<VoiceLibrary | null>(null);

  // Search + per-context catalog visibility.
  const [search, setSearch] = useState('');
  const [browsingFor, setBrowsingFor] = useState<ContextRow['key'] | null>(null);

  // Recently-used voice ids (top of catalog list).
  const [recent, setRecent] = useState<string[]>(loadRecentVoiceIds);

  // Preview audio — single shared element so playing one auto-stops
  // the previous.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    setMapping(loadLocalMapping());
    setRecent(loadRecentVoiceIds());
    let cancelled = false;
    void (async () => {
      const lib = await fetchVoiceLibrary(httpCfg);
      if (cancelled) return;
      setLibrary(lib);
      setSyncStatus(lib === null ? 'offline' : 'synced');
    })();
    return () => { cancelled = true; };
  }, [httpCfg]);

  const voiceById = useMemo(() => {
    const map = new Map<string, VoiceLibraryEntry>();
    if (library) for (const v of library.voices) map.set(v.id, v);
    return map;
  }, [library]);

  const filteredVoices = useMemo(() => {
    if (!library) return [];
    return filterVoices(library.voices, search);
  }, [library, search]);

  const applyVoiceToContext = async (ctx: ContextRow['key'], voiceId: string | null) => {
    const trimmed = (voiceId ?? '').trim();
    const next: Mapping = { ...mapping };
    if (trimmed) next[ctx] = trimmed;
    else delete next[ctx];
    setMapping(next);
    saveLocalMapping(next);
    if (trimmed) {
      rememberRecentVoiceId(trimmed);
      setRecent(loadRecentVoiceIds());
    }
    setSyncStatus('syncing');
    debugLog('settings.tts-voice.apply', { context: ctx, voiceId: trimmed || null });
    const patch: TtsVoiceMappingPatch = { [ctx]: trimmed || null };
    const status = await pushTtsVoiceMappingToDaemon(httpCfg, patch);
    setSyncStatus(status);
  };

  const resetAll = async () => {
    setMapping({});
    clearLocalMapping();
    setSyncStatus('syncing');
    debugLog('settings.tts-voice.reset-all');
    const status = await pushTtsVoiceMappingToDaemon(httpCfg, {
      default: null, chat: null, digest: null, alert: null, discord: null,
    });
    setSyncStatus(status);
  };

  const playPreview = (voice: VoiceLibraryEntry) => {
    if (!voice.previewUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    const a = new Audio(voice.previewUrl);
    audioRef.current = a;
    setPreviewing(voice.id);
    a.addEventListener('ended', () => setPreviewing((cur) => cur === voice.id ? null : cur));
    a.addEventListener('error', () => setPreviewing((cur) => cur === voice.id ? null : cur));
    void a.play().catch(() => setPreviewing((cur) => cur === voice.id ? null : cur));
    debugLog('settings.tts-voice.preview', { voiceId: voice.id });
  };

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPreviewing(null);
  };

  const anyMapped = Object.keys(mapping).length > 0;
  const showCatalog = browsingFor !== null;
  const libraryReady = library !== null && library.voices.length > 0;

  return (
    <section
      data-testid="tts-voice-id-picker-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">🗣️ Voice identity (per context)</h3>
          <p className="text-xs text-muted-foreground">
            Pick a different voice per surface (chat / morning digest / alerts /
            Discord). Browse the ElevenLabs library or paste a voice id directly.
          </p>
        </div>
        {syncStatus === 'syncing' && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600" data-testid="tts-voice-sync-status">
            Syncing…
          </span>
        )}
        {syncStatus === 'synced' && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600" data-testid="tts-voice-sync-status">
            Synced
          </span>
        )}
        {syncStatus === 'offline' && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600" data-testid="tts-voice-sync-status" title="Daemon unreachable">
            Offline
          </span>
        )}
        {syncStatus === 'error' && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600" data-testid="tts-voice-sync-status">
            Sync error
          </span>
        )}
      </header>

      {library && !library.configured && (
        <div
          className="mb-3 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          data-testid="tts-voice-library-unconfigured"
        >
          ElevenLabs API key not set — set <code className="font-mono">ELEVENLABS_API_KEY</code> in
          your env or store via <code className="font-mono">monad config set-secret elevenlabs.apiKey &lt;key&gt;</code>
          {' '}to browse the 10k+ voice library.
        </div>
      )}

      <div className="space-y-2" data-testid="tts-voice-rows">
        {CONTEXT_ROWS.map((row) => {
          const current = mapping[row.key];
          const currentVoice = current ? voiceById.get(current) : undefined;
          return (
            <div key={row.key} className="rounded-md border border-input bg-background px-3 py-2">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium" data-testid={`tts-voice-row-${row.key}-label`}>
                  {row.label}
                </span>
                {currentVoice && (
                  <span className="text-[11px] text-muted-foreground" data-testid={`tts-voice-row-${row.key}-current-name`}>
                    {currentVoice.name}
                    {' '}<span className="opacity-60">· {describeVoice(currentVoice)}</span>
                  </span>
                )}
                {current && !currentVoice && (
                  <span className="font-mono text-[10px] text-muted-foreground" data-testid={`tts-voice-row-${row.key}-current`}>
                    {current}
                  </span>
                )}
              </div>
              <p className="mb-1 text-[10px] text-muted-foreground">{row.hint}</p>
              <div className="flex gap-2">
                <Input
                  defaultValue={current ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (current ?? '')) void applyVoiceToContext(row.key, v || null);
                  }}
                  placeholder="Voice id (paste) or use Browse →"
                  className="text-xs"
                  data-testid={`tts-voice-row-${row.key}-input`}
                />
                <Button
                  type="button"
                  size="sm"
                  variant={browsingFor === row.key ? 'default' : 'outline'}
                  onClick={() => setBrowsingFor(browsingFor === row.key ? null : row.key)}
                  disabled={!libraryReady}
                  className="text-xs"
                  data-testid={`tts-voice-row-${row.key}-browse`}
                  title={libraryReady ? 'Browse library' : 'Library not loaded yet'}
                >
                  Browse
                </Button>
                {currentVoice?.previewUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => previewing === currentVoice.id ? stopPreview() : playPreview(currentVoice)}
                    className="text-xs"
                    data-testid={`tts-voice-row-${row.key}-preview`}
                  >
                    {previewing === currentVoice.id ? '⏸' : '▶'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => applyVoiceToContext(row.key, null)}
                  disabled={!current}
                  className="text-xs text-muted-foreground"
                  data-testid={`tts-voice-row-${row.key}-clear`}
                >
                  Clear
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {showCatalog && libraryReady && (
        <div
          className="mt-3 rounded-md border border-input bg-background p-2"
          data-testid="tts-voice-library-catalog"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search voices (name · accent · gender · description)"
              className="text-xs"
              data-testid="tts-voice-library-search"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setBrowsingFor(null)}
              className="text-xs text-muted-foreground"
              data-testid="tts-voice-library-close"
            >
              Close
            </Button>
          </div>

          {recent.length > 0 && !search && (
            <div className="mb-2" data-testid="tts-voice-recent-row">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Recently used</p>
              <div className="flex flex-wrap gap-1">
                {recent.map((id) => {
                  const v = voiceById.get(id);
                  if (!v) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="rounded border border-border/40 bg-muted/30 px-2 py-1 text-[11px] hover:bg-muted"
                      onClick={() => browsingFor && applyVoiceToContext(browsingFor, id)}
                      data-testid={`tts-voice-recent-${id}`}
                    >
                      {v.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {filteredVoices.length} voice{filteredVoices.length === 1 ? '' : 's'}
            {search && ` matching "${search}"`}
          </p>
          <div
            className="max-h-64 space-y-1 overflow-y-auto pr-1"
            data-testid="tts-voice-library-list"
          >
            {filteredVoices.slice(0, 50).map((v) => {
              const isPreviewingThis = previewing === v.id;
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/40 bg-muted/20 px-2 py-1 text-xs"
                  data-testid={`tts-voice-library-row-${v.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{v.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {describeVoice(v)}
                      {v.description && <span> · {v.description}</span>}
                    </div>
                  </div>
                  {v.previewUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => isPreviewingThis ? stopPreview() : playPreview(v)}
                      className="text-xs"
                      data-testid={`tts-voice-library-preview-${v.id}`}
                    >
                      {isPreviewingThis ? '⏸' : '▶'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => browsingFor && applyVoiceToContext(browsingFor, v.id)}
                    className="text-xs"
                    data-testid={`tts-voice-library-apply-${v.id}`}
                  >
                    Apply
                  </Button>
                </div>
              );
            })}
            {filteredVoices.length > 50 && (
              <p className="text-center text-[10px] text-muted-foreground">
                Showing first 50 of {filteredVoices.length} · refine the search to see more
              </p>
            )}
            {filteredVoices.length === 0 && (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                No voices match "{search}"
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetAll}
          disabled={!anyMapped}
          className="text-xs text-muted-foreground"
          data-testid="tts-voice-reset-all"
        >
          Reset all
        </Button>
        <p className="text-[10px] text-muted-foreground/80">
          {libraryReady
            ? `${library?.voices.length ?? 0} voices · library cache via daemon`
            : 'Paste voice id manually until daemon library is reachable'}
        </p>
      </div>
    </section>
  );
}
