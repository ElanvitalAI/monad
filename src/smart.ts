import { readFileSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';
import { LOCAL_SKILLS_DIR, SERVICES, ENV_FILE_PATTERNS } from './config.js';
import { hashFile } from './hasher.js';
import { getRemoteFileList, getRemoteFileContent, getRemoteFileHash } from './inspect.js';
import { getDeltas, upsertDelta } from './db.js';
import { analyzeDiff, analyzeServicePattern, isGrokAvailable } from './grok.js';
import * as ui from './ui.js';
import type { DiffResult, FileDiff, EnvDelta, ServiceDelta } from './types.js';

// Patterns that indicate env-specific content
const ENV_PATTERNS = [
  /^[A-Z_]+=.+/,           // KEY=value
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /\/Users\/\w+/,           // macOS user paths
  /\/home\/\w+/,            // Linux user paths
  /localhost:\d+/,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /port\s*[:=]\s*\d+/i,
];

function isEnvFile(path: string): boolean {
  const name = path.split('/').pop() || '';
  return ENV_FILE_PATTERNS.some(p => {
    if (p.includes('*')) {
      const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(name);
    }
    return name === p;
  });
}

function detectEnvDeltas(localContent: string, remoteContent: string, filePath: string): EnvDelta[] {
  const deltas: EnvDelta[] = [];

  if (isEnvFile(filePath)) {
    // Parse KEY=VALUE pairs
    const localLines = parseEnvLines(localContent);
    const remoteLines = parseEnvLines(remoteContent);

    for (const [key, localVal] of Object.entries(localLines)) {
      const remoteVal = remoteLines[key];
      if (remoteVal !== undefined && remoteVal !== localVal) {
        deltas.push({
          file: filePath,
          key,
          localValue: localVal,
          remoteValue: remoteVal,
          type: 'env_var',
        });
      }
    }
  } else {
    // Check line-by-line for env-sensitive patterns
    const localL = localContent.split('\n');
    const remoteL = remoteContent.split('\n');

    for (let i = 0; i < Math.max(localL.length, remoteL.length); i++) {
      const ll = localL[i] || '';
      const rl = remoteL[i] || '';
      if (ll !== rl) {
        for (const pattern of ENV_PATTERNS) {
          if (pattern.test(ll) || pattern.test(rl)) {
            // Extract a key name from the line
            const keyMatch = ll.match(/^[\s]*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/) ||
                             rl.match(/^[\s]*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/);
            const key = keyMatch ? keyMatch[1] : `line_${i + 1}`;

            // Determine delta type
            let type: EnvDelta['type'] = 'config_value';
            if (/\/Users\/|\/home\//.test(ll) || /\/Users\/|\/home\//.test(rl)) {
              type = 'path_ref';
            } else if (/api[_-]?key|secret|token|password/i.test(ll + rl)) {
              type = 'env_var';
            }

            deltas.push({ file: filePath, key, localValue: ll.trim(), remoteValue: rl.trim(), type });
            break;
          }
        }
      }
    }
  }

  return deltas;
}

function parseEnvLines(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

export async function computeDiff(
  skillName: string,
  server: string,
  service: string,
): Promise<DiffResult> {
  const remotePath = SERVICES[service];
  const localDir = join(LOCAL_SKILLS_DIR, skillName);

  // Get file lists
  const remoteFiles = await getRemoteFileList(server, remotePath, skillName);

  // Get local files (reuse hasher logic but just paths)
  const { getFileTree } = await import('./hasher.js');
  const localTree = getFileTree(localDir);
  const localFiles = localTree.map(e => e.path);

  const localSet = new Set(localFiles);
  const remoteSet = new Set(remoteFiles);

  const localOnly = localFiles.filter(f => !remoteSet.has(f));
  const remoteOnly = remoteFiles.filter(f => !localSet.has(f));
  const common = localFiles.filter(f => remoteSet.has(f));

  // Compare common files
  const modified: FileDiff[] = [];
  const envDeltas: EnvDelta[] = [];

  // Batch hash comparisons for common files
  for (const filePath of common) {
    const localHash = hashFile(join(localDir, filePath));
    const remoteHash = await getRemoteFileHash(server, remotePath, `${skillName}/${filePath}`);

    if (localHash && remoteHash && localHash !== remoteHash) {
      const fd: FileDiff = { path: filePath, localHash, remoteHash };

      // For text files, get diff content
      if (isTextFile(filePath)) {
        try {
          const localContent = readFileSync(join(localDir, filePath), 'utf-8');
          const remoteContent = await getRemoteFileContent(server, remotePath, `${skillName}/${filePath}`);

          // Detect env-specific deltas
          const fileDeltas = detectEnvDeltas(localContent, remoteContent, filePath);
          envDeltas.push(...fileDeltas);

          // Generate unified diff (first 50 lines)
          if (localContent !== remoteContent) {
            const diffLines = simpleDiff(localContent, remoteContent, filePath);
            fd.diff = diffLines.slice(0, 50).join('\n');
          }
        } catch {
          // skip
        }
      }

      modified.push(fd);
    }
  }

  return { skillName, server, service, localOnly, remoteOnly, modified, envDeltas };
}

function isTextFile(path: string): boolean {
  const textExts = new Set([
    '.md', '.txt', '.ts', '.js', '.json', '.yaml', '.yml', '.toml',
    '.env', '.sh', '.zsh', '.bash', '.css', '.html', '.xml', '.svg',
    '.py', '.rb', '.go', '.rs', '.sql', '.graphql', '.tsx', '.jsx',
    '.cfg', '.ini', '.conf', '.properties', '.local',
  ]);
  const ext = '.' + (path.split('.').pop() || '').toLowerCase();
  const name = path.split('/').pop() || '';
  return textExts.has(ext) || name.startsWith('.env') || name === 'Makefile' || name === 'Dockerfile';
}

function simpleDiff(local: string, remote: string, file: string): string[] {
  const ll = local.split('\n');
  const rl = remote.split('\n');
  const lines: string[] = [`--- local/${file}`, `+++ remote/${file}`];

  for (let i = 0; i < Math.max(ll.length, rl.length); i++) {
    if (ll[i] !== rl[i]) {
      if (rl[i] !== undefined) lines.push(`-${rl[i]}`);
      if (ll[i] !== undefined) lines.push(`+${ll[i]}`);
    }
  }
  return lines;
}

export async function smartSync(
  skillName: string,
  server: string,
  service: string,
  localDir: string,
): Promise<{ diff: DiffResult; excludeFiles: string[] }> {
  ui.subheader(`Smart analyzing ${skillName} on ${server}:${service}`);

  const diff = await computeDiff(skillName, server, service);
  ui.showDiffResult(diff);

  // Check remembered deltas
  const rememberedDeltas = getDeltas(server, service, skillName);
  if (rememberedDeltas.length) {
    ui.showDeltaMemory(server, service, skillName, rememberedDeltas);
  }

  // Files to exclude from sync (preserve remote version)
  const excludeFiles: string[] = [];

  if (diff.envDeltas.length > 0) {
    // Use Grok to analyze if available
    if (isGrokAvailable()) {
      const { preserveDeltas, analysis } = await analyzeDiff(diff);
      ui.showGrokAnalysis(skillName, analysis);

      // Mark files with env deltas for exclusion
      for (const delta of preserveDeltas) {
        if (!excludeFiles.includes(delta.file)) {
          excludeFiles.push(delta.file);
          ui.showEnvDeltaPreserved(delta);
        }

        // Remember this delta
        const now = new Date().toISOString();
        upsertDelta({
          server, service, skillName,
          deltaType: delta.type === 'env_var' ? 'env_var' : delta.type === 'path_ref' ? 'path' : 'config',
          description: `${delta.key} in ${delta.file}`,
          pattern: delta.key,
          filePath: delta.file,
          preserve: true,
          detectedAt: now,
          lastSeen: now,
          grokAnalysis: analysis,
        });
      }
    } else {
      // Without Grok, preserve all env-sensitive files
      for (const delta of diff.envDeltas) {
        if (!excludeFiles.includes(delta.file)) {
          excludeFiles.push(delta.file);
          ui.showEnvDeltaPreserved(delta);
        }
      }
    }
  }

  // Also exclude files from remembered deltas
  for (const d of rememberedDeltas) {
    if (d.preserve && d.filePath && !excludeFiles.includes(d.filePath)) {
      excludeFiles.push(d.filePath);
    }
  }

  return { diff, excludeFiles };
}

export async function analyzeAndRememberPatterns(
  server: string,
  service: string,
  allDiffs: DiffResult[],
): Promise<void> {
  if (!isGrokAvailable() || allDiffs.length === 0) return;

  const diffsWithDeltas = allDiffs.filter(d => d.envDeltas.length > 0);
  if (diffsWithDeltas.length < 2) return; // Need at least 2 skills with deltas to find patterns

  ui.subheader(`Analyzing patterns for ${server}:${service}`);
  const analysis = await analyzeServicePattern(server, service, diffsWithDeltas);
  ui.showGrokAnalysis(`${server}:${service}`, analysis);
}
