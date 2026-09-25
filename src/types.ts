// ── Shared types ──

export interface ServerConfig {
  name: string;
  host: string; // SSH host alias
}

export interface ServiceConfig {
  name: string;
  path: string; // remote path template
}

export interface SyncTarget {
  server: string;
  service: string;
  remotePath: string;
}

export interface SkillInfo {
  name: string;
  localPath: string;
  hash: string;
  fileCount: number;
  totalBytes: number;
  fileTree: FileTreeEntry[];
}

export interface FileTreeEntry {
  path: string;      // relative path within skill
  size: number;
  mtime: string;     // ISO8601
  hash?: string;     // sha256 of individual file (for diff)
}

export interface SyncSession {
  id?: number;
  startedAt: string;
  completedAt?: string;
  mode: SyncMode;
  servers: string[];
  services: string[];
  skills: string[];
}

export type SyncMode = 'clean' | 'merge' | 'smart';

export interface SyncEntry {
  id?: number;
  sessionId: number;
  skillName: string;
  server: string;
  service: string;
  localHash: string;
  prevHash?: string;
  status: SyncStatus;
  changed: boolean;
  fileCount?: number;
  totalBytes?: number;
  durationMs?: number;
  diffSummary?: string;
  syncedAt: string;
}

export type SyncStatus = 'synced' | 'failed' | 'skipped' | 'unchanged';

export interface SkillSnapshot {
  skillName: string;
  server: string;
  service: string;
  hash: string;
  fileTree: string; // JSON
  syncedAt: string;
}

export interface ServiceDelta {
  id?: number;
  server: string;
  service: string;
  skillName: string;
  deltaType: DeltaType;
  description: string;
  pattern?: string;
  filePath?: string;
  preserve: boolean;
  detectedAt: string;
  lastSeen: string;
  grokAnalysis?: string;
}

export type DeltaType = 'env_var' | 'config' | 'path' | 'custom';

export interface RemoteInspection {
  server: string;
  service: string;
  remotePath: string;
  status: 'exists' | 'empty' | 'none' | 'unreachable';
  folders: RemoteFolder[];
  error?: string;
}

export interface RemoteFolder {
  name: string;
  isOverlap: boolean; // exists locally too
}

export interface DiffResult {
  skillName: string;
  server: string;
  service: string;
  localOnly: string[];      // files only in local
  remoteOnly: string[];     // files only in remote
  modified: FileDiff[];     // files that differ
  envDeltas: EnvDelta[];    // detected env-specific differences
}

export interface FileDiff {
  path: string;
  localHash: string;
  remoteHash: string;
  diff?: string; // unified diff content
}

export interface EnvDelta {
  file: string;
  key: string;
  localValue?: string;
  remoteValue?: string;
  type: 'env_var' | 'config_value' | 'path_ref';
}

export interface GrokAnalysis {
  shouldPreserve: boolean;
  reason: string;
  deltaType: DeltaType;
  pattern?: string;
}
