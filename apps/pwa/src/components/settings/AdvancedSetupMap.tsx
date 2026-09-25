'use client';

// T1.B — Advanced setup map (NEXUS native vs wizard 분업 안내).
//
// NEXUS path 사용자가 wizard 영역 존재 + 셋업 위치를 한눈에 파악하도록
// SettingsPanel 하단에 read-only table. Hard-coded snapshot — v2 (ROADMAP
// §9.1) 에서 dynamic detection (실제 cfg/NEXUS state read) 으로 ✓/◯
// 반응형 전환.
//
// 이 카드는 PR T1.A 의 WelcomeCard hint 다음 layer — welcome 1회 dismiss
// 이후에도 영구 reference 로 살아남음.

interface SetupRow {
  area: string;
  status: string;
  location: string;
  cmd?: string;
}

const ROWS: ReadonlyArray<SetupRow> = [
  { area: 'Chat 백엔드', status: '✓ NEXUS native', location: 'PWA Quick Setup card' },
  { area: 'Telegram bot token', status: '✓ NEXUS native', location: 'PWA Secret modal' },
  { area: 'Discord bot token', status: '✓ NEXUS native', location: 'PWA Secret modal' },
  { area: 'Telegram allowlist', status: '◯ Wizard 전용', location: 'desktop', cmd: 'monad legacy → /setup' },
  { area: 'Discord guild · voice', status: '◯ Wizard 전용', location: 'desktop', cmd: 'monad legacy → /setup' },
  { area: 'OS 자동 부팅', status: '◯ NEXUS subcommand', location: 'desktop', cmd: 'monad nexus install --launchd' },
];

export function AdvancedSetupMap() {
  return (
    <section
      data-testid="advanced-setup-map"
      className="space-y-2"
    >
      <h2 className="text-sm font-medium">Advanced setup map</h2>
      <div className="rounded-md border border-border bg-card p-3 text-xs">
        <p className="mb-2 text-muted-foreground">
          NEXUS native 셋업 영역은 PWA 에서 직접 · 그 외 advanced 셋업은
          desktop wizard 또는 NEXUS subcommand 에서.
        </p>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-1 pr-2 font-medium">영역</th>
              <th className="py-1 pr-2 font-medium">상태</th>
              <th className="py-1 font-medium">셋업 위치</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.area}
                data-testid={`advanced-setup-row-${row.area}`}
                className="border-b border-border/50 last:border-0"
              >
                <td className="py-1.5 pr-2 font-medium">{row.area}</td>
                <td className="py-1.5 pr-2 font-mono text-[10px]">{row.status}</td>
                <td className="py-1.5 text-muted-foreground">
                  {row.location}
                  {row.cmd && (
                    <>
                      {' · '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                        {row.cmd}
                      </code>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
