import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC_DIR = resolve(import.meta.dir, '..', 'src');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
      continue;
    }
    if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ⛔⭐⭐ 파일이 «사라졌을 때」 ENOENT 를 그대로 던지면 산출이 ***「크래시」로 읽힌다.***
//   📏 2026-08-26 실측: 이 파일이 그 상태로 빨갛게 서 있었고, 산출만 봐서는
//      「계약이 깨졌다」인지 ***「파일이 이사 갔다」***인지 «안 갈렸다».
//   ⇒ 이름을 대고 «어느 쪽인지 물어라」고 말한다. 「0건」을 읽기 전에 세는 그 규율의 파일 판본이다.
function read(rel: string): string {
  const abs = resolve(import.meta.dir, '..', rel);
  try {
    return readFileSync(abs, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(
      `source-truth 대상이 «없다»: ${rel}\n`
      + '⛔ 「계약이 깨졌다」가 아니라 «파일이 옮겨졌을» 수 있다 — 먼저 세라:\n'
      + `   rg -l --no-ignore -g '*.ts' '<이 파일이 무는 심볼>' src/\n`
      + '   옮겨졌으면 이 경로를 고치고, 정말 사라졌으면 이 시험이 무는 계약이 «누구 것이었는지»를 적고 지워라.',
    );
  }
}

describe('ui foundation · R3 embedded bridge source truth', () => {
  test('no production caller injects the old embedded bridge anymore', () => {
    const files = walkTs(SRC_DIR);
    const hits = files.filter((file) => readFileSync(file, 'utf8').includes('embedded: true'));
    const relHits = hits.map((file) => file.replace(`${resolve(import.meta.dir, '..')}/`, '')).sort();
    expect(relHits).toEqual([]);
  });

  test('renderModalOverlay uses content-only adapter + shared chrome frame helper', () => {
    // 🪞 2026-08-26 — 디렉토리 재구성으로 옮겨졌다(src/layout-render.ts → src/layout/render.ts).
    //   계약(paintChromeFrame ⊕ renderWidgetBodyWithoutTitle)은 «내내» 지켜지고 있었다.
    const src = read('src/layout/render.ts');
    expect(src).toContain('computeChromeInnerBounds');
    expect(src).toContain('paintChromeFrame');
    expect(src).toContain('renderWidgetBodyWithoutTitle');
  });

  test('live modal uses content-only adapter and mouse row translation', () => {
    // 🪞 2026-08-26 — src/dashboard-pane-multi-modal.ts → src/dashboard/modals/pane-multi.ts
    const src = read('src/dashboard/modals/pane-multi.ts');
    expect(src).toContain('renderWidgetBodyWithoutTitle');
    expect(src).toContain('contentOnlyMouseRow');
  });

  test('plugin types no longer expose RenderCtx.embedded', () => {
    // 🪞 2026-08-26 — src/plugin-types.ts → src/plugins/core/types.ts (RenderCtx 가 거기 있다)
    const pluginTypes = read('src/plugins/core/types.ts');
    expect(pluginTypes.includes('embedded?: boolean')).toBe(false);
  });
});
