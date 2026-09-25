// 「전용 테스트가 있는데 제품 소비자가 0」인 모듈을 센다 (F12 탐지기 시제품)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src'];
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith('.ts') && !e.endsWith('.test.ts') && !e.endsWith('.d.ts')) files.push(p);
  }
};
for (const r of roots) walk(r);

// 전용 테스트가 있는 모듈만 후보로 (= 누군가 «공들여» 지었다)
const hasTest = (f: string): boolean => {
  const b = basename(f, '.ts');
  try {
    const out = execFileSync('rg', ['-l', '--glob', `*${b}.test.ts`, '--files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().length > 0;
  } catch { return false; }
};

const orphans: Array<{ file: string; sym: string }> = [];
let candidates = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const m = /^export (?:async )?function ([A-Za-z0-9_]+)/m.exec(src);
  if (!m) continue;
  const sym = m[1]!;
  const b = basename(f, '.ts');
  if (!hasTest(f)) continue;
  candidates += 1;
  let hits = '';
  try {
    hits = execFileSync('rg', ['-l', '--glob', '!node_modules', '--glob', '!*.test.ts', '--glob', '!.next', '-F', sym, 'src', 'apps', 'scripts', 'bin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { hits = ''; }
  const consumers = hits.split('\n').filter((l) => l.trim() && l.trim() !== f);
  if (consumers.length === 0) orphans.push({ file: f, sym });
}
console.log(`모집단: 전용 테스트가 있는 «함수 export» 모듈 ${candidates}개`);
console.log(`⇒ 제품 소비자 0 인 것: ${orphans.length}개 (${((orphans.length / Math.max(candidates,1)) * 100).toFixed(0)}%)`);
console.log('');
for (const o of orphans.slice(0, 20)) console.log(`  ${o.sym.padEnd(34)} ${o.file}`);
