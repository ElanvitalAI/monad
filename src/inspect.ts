import { $ } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SERVICES, isLocalSyncServer } from './config.js';
import { hashFile } from './hasher.js';
import type { RemoteInspection, RemoteFolder } from './types.js';

export async function inspectRemote(
  server: string,
  service: string,
  localSkills: Set<string>,
): Promise<RemoteInspection> {
  const remotePath = SERVICES[service];
  const result: RemoteInspection = {
    server,
    service,
    remotePath,
    status: 'none',
    folders: [],
  };

  try {
    if (isLocalSyncServer(server)) {
      if (!existsSync(remotePath)) {
        result.status = 'none';
        return result;
      }

      const folders = readdirSync(remotePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();

      result.status = folders.length > 0 ? 'exists' : 'empty';
      result.folders = folders.map(name => ({
        name,
        isOverlap: localSkills.has(name),
      }));
      return result;
    }

    const output = await $`ssh -o ConnectTimeout=5 ${server} ${`
      if [ -d '${remotePath}' ]; then
        count=$(find '${remotePath}' -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
        if [ "$count" -gt 0 ]; then
          echo "EXISTS:$count"
          find '${remotePath}' -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r d; do basename "$d"; done | sort
        else
          echo EMPTY
        fi
      else
        echo NONE
      fi
    `}`.text();

    const lines = output.trim().split('\n');
    const firstLine = lines[0];

    if (firstLine === 'NONE') {
      result.status = 'none';
    } else if (firstLine === 'EMPTY') {
      result.status = 'empty';
    } else if (firstLine.startsWith('EXISTS:')) {
      result.status = 'exists';
      result.folders = lines.slice(1)
        .filter(Boolean)
        .map(name => ({
          name,
          isOverlap: localSkills.has(name),
        }));
    }
  } catch (err: any) {
    result.status = 'unreachable';
    result.error = err.message || String(err);
  }

  return result;
}

export async function getRemoteFileList(
  server: string,
  remotePath: string,
  skillName: string,
): Promise<string[]> {
  try {
    if (isLocalSyncServer(server)) {
      return listLocalFiles(join(remotePath, skillName));
    }

    const output = await $`ssh -o ConnectTimeout=10 ${server} ${`
      if [ -d '${remotePath}${skillName}' ]; then
        find '${remotePath}${skillName}' -type f 2>/dev/null | while read -r f; do
          echo "\${f#${remotePath}${skillName}/}"
        done | sort
      fi
    `}`.text();
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function getRemoteFileContent(
  server: string,
  remotePath: string,
  filePath: string,
): Promise<string> {
  try {
    if (isLocalSyncServer(server)) {
      return readFileSync(join(remotePath, filePath), 'utf-8');
    }

    return await $`ssh -o ConnectTimeout=10 ${server} cat '${remotePath}${filePath}'`.text();
  } catch {
    return '';
  }
}

export async function getRemoteFileHash(
  server: string,
  remotePath: string,
  filePath: string,
): Promise<string> {
  try {
    if (isLocalSyncServer(server)) {
      return hashFile(join(remotePath, filePath));
    }

    const output = await $`ssh -o ConnectTimeout=10 ${server} shasum -a 256 '${remotePath}${filePath}'`.text();
    return output.trim().split(/\s+/)[0] || '';
  } catch {
    return '';
  }
}

function listLocalFiles(root: string): string[] {
  const files: string[] = [];
  walkLocalFiles(root, root, files);
  return files.sort();
}

function walkLocalFiles(dir: string, root: string, files: string[]): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLocalFiles(full, root, files);
    } else if (entry.isFile()) {
      files.push(full.slice(root.length + 1));
    }
  }
}
