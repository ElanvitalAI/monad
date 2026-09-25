import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityProviders } from '../mission-capabilities/registry.js';

const RE_ID = /^req:v1:[0-9a-f]{16}$/;
const RE_CAP = /^[a-z]+\.[a-z.]+$/;
const norm = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

export type MissionRequestJudgment =
  | { file: string; status: 'invalid-request'; reasons: string[] }
  | { file: string; status: 'missing-capability'; capabilityCount: number; missingCapabilities: { id: string; path: string }[] }
  | { file: string; status: 'missing-blueprint'; capabilityCount: number }
  | { file: string; status: 'blueprint-candidate'; capabilityCount: number; blueprintPath: string };

const CAPABILITY_ROOT = fileURLToPath(new URL('../mission-capabilities/', import.meta.url));

function capabilityPath(capability: string): string {
  const [directory, ...rest] = capability.split('.');
  return join(CAPABILITY_ROOT, directory!, `${rest.join('.')}.ts`);
}

export interface MissionRequestJudgeResult {
  authorityRoot: string;
  requestCatalog: string;
  catalogStatus: 'present' | 'missing';
  requestsScanned: number;
  invalidCount: number;
  judgments: MissionRequestJudgment[];
}

export function judgeMissionRequests(authorityRoot: string): MissionRequestJudgeResult {
  const root = resolve(authorityRoot);
  const requestCatalog = join(root, 'docs/mission-requests');
  if (!existsSync(requestCatalog)) {
    return { authorityRoot: root, requestCatalog, catalogStatus: 'missing', requestsScanned: 0, invalidCount: 0, judgments: [] };
  }

  const files = readdirSync(requestCatalog).filter((file) => file.endsWith('.md')).sort();
  const registeredCapabilityIds = new Set(capabilityProviders.map((provider) => provider.id));
  const judgments: MissionRequestJudgment[] = [];

  for (const file of files) {
    const source = readFileSync(join(requestCatalog, file), 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1];
    if (!frontmatter) {
      judgments.push({ file, status: 'invalid-request', reasons: ['프론트매터 없음'] });
      continue;
    }
    const get = (key: string): string | undefined => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim();
    const id = get('id');
    const intent = get('intent')?.replace(/^"|"$/g, '');
    const schedule = get('schedule')?.replace(/^"|"$/g, '');
    const requires = get('requires');
    const missingKeys = [['id', id], ['intent', intent], ['schedule', schedule], ['requires', requires]]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missingKeys.length > 0) {
      judgments.push({ file, status: 'invalid-request', reasons: [`키 없음 ${missingKeys.join(',')}`] });
      continue;
    }

    const capabilities = requires!.replace(/^\[|\]$/g, '').split(',').map((capability) => capability.trim()).filter(Boolean);
    const reasons: string[] = [];
    if (!RE_ID.test(id!)) reasons.push('id 형식 위반');
    if (schedule!.split(/\s+/).length !== 5) reasons.push('schedule cron 5필드 아님');
    for (const capability of capabilities) {
      if (!RE_CAP.test(capability)) reasons.push(`능력 id 형식 위반: ${capability}`);
      if (capability.includes('..') || capability.includes('/')) reasons.push(`경로 탈출 문자: ${capability}`);
    }
    const hash = createHash('sha256').update(`${norm(intent!)}|${schedule}|${[...capabilities].sort().join(',')}`).digest('hex').slice(0, 16);
    if (id !== `req:v1:${hash}`) reasons.push(`id 해시 불일치(기대 req:v1:${hash})`);
    if (reasons.length > 0) {
      judgments.push({ file, status: 'invalid-request', reasons });
      continue;
    }

    const missingCapabilities = capabilities
      .filter((capability) => !registeredCapabilityIds.has(capability))
      .map((capability) => ({ id: capability, path: capabilityPath(capability) }));
    if (missingCapabilities.length > 0) {
      judgments.push({ file, status: 'missing-capability', capabilityCount: capabilities.length, missingCapabilities });
      continue;
    }

    const blueprintPath = join(root, 'src/mission-blueprints', `${id!.replace(/:/g, '-')}.ts`);
    judgments.push(existsSync(blueprintPath)
      ? { file, status: 'blueprint-candidate', capabilityCount: capabilities.length, blueprintPath }
      : { file, status: 'missing-blueprint', capabilityCount: capabilities.length });
  }

  return {
    authorityRoot: root,
    requestCatalog,
    catalogStatus: 'present',
    requestsScanned: files.length,
    invalidCount: judgments.filter((judgment) => judgment.status === 'invalid-request').length,
    judgments,
  };
}
