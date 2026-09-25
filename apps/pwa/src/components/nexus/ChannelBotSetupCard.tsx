'use client';

// T2.A — channel-bot setup-needed card (PWA mirror).
//
// Token-missing 채널-봇 탭이 inert 상태로 silent 비활성될 때 사용자가
// "왜 안 떠?" 의문을 inline 안내 카드로 해소. TUI staticChannelBotView
// 와 같은 SSoT (`buildChannelBotSetupHint`) 에서 파생된 정보를 PWA UI
// 로 mirror.
//
// 3 setup paths:
//   📱 PWA Settings → Secret modal (이 PWA 안에서 직접 셋업)
//   💻 monad setup <platform>   (full wizard · desktop)
//   🔑 export MONAD_*_BOT_TOKEN=…  (env-var direct)

export type ChannelBotPlatform = 'telegram' | 'discord';

interface SetupPathCopy {
  pwaPath: string;
  wizardCmd: string;
  envSnippet: string;
  tokenSource: string;
  wizardOnlyNote: string;
  tokenEnvName: string;
}

const TOKEN_ENV: Record<ChannelBotPlatform, string> = {
  telegram: 'MONAD_TELEGRAM_BOT_TOKEN',
  discord: 'MONAD_DISCORD_BOT_TOKEN',
};

const TOKEN_SOURCE: Record<ChannelBotPlatform, string> = {
  telegram: 'BotFather (@BotFather) → /newbot',
  discord: 'discord.com/developers/applications',
};

// SSoT: src/nexus/kinds/channel-bot.ts · buildChannelBotSetupHint
// (TUI 와 PWA 모두 같은 카피 — server 가 카피를 서빙해주지 않으므로
//  PWA 쪽에서 평행 정의. Drift 시 setup-card test 가 잡음.)
export function deriveSetupHint(platform: ChannelBotPlatform): SetupPathCopy {
  const tokenEnvName = TOKEN_ENV[platform];
  return {
    tokenEnvName,
    pwaPath: `PWA Settings → Secret modal → ${tokenEnvName}`,
    wizardCmd: `monad setup ${platform}`,
    envSnippet: `export ${tokenEnvName}=…`,
    tokenSource: TOKEN_SOURCE[platform],
    wizardOnlyNote:
      platform === 'telegram'
        ? 'Allowlist · home channel 등은 desktop wizard 에서.'
        : 'Guild · voice channel 등은 desktop wizard 에서.',
  };
}

interface ChannelBotSetupCardProps {
  platform: ChannelBotPlatform;
}

export function ChannelBotSetupCard({ platform }: ChannelBotSetupCardProps) {
  const hint = deriveSetupHint(platform);
  return (
    <div
      data-testid={`channel-bot-setup-card-${platform}`}
      className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden>⚠</span>
        <strong>Bot token 미설정</strong>
        <span className="text-amber-700 dark:text-amber-300">
          — token 만 입력하면 NEXUS 가 자동 spawn 합니다.
        </span>
      </div>

      <p className="mb-1 font-medium">셋업 경로</p>
      <ul className="mb-2 space-y-1">
        <li>
          <span className="mr-1.5" aria-hidden>📱</span>
          {hint.pwaPath}
        </li>
        <li>
          <span className="mr-1.5" aria-hidden>💻</span>
          <code className="rounded bg-amber-100 px-1 py-0.5 font-mono dark:bg-amber-900">
            {hint.wizardCmd}
          </code>{' '}
          (full wizard · desktop)
        </li>
        <li>
          <span className="mr-1.5" aria-hidden>🔑</span>
          <code className="rounded bg-amber-100 px-1 py-0.5 font-mono dark:bg-amber-900">
            {hint.envSnippet}
          </code>
        </li>
      </ul>

      <p className="mb-1 text-[11px] text-amber-700 dark:text-amber-300">
        Token 받기:{' '}
        <span className="font-mono">{hint.tokenSource}</span>
      </p>
      <p className="text-[11px] text-amber-700 dark:text-amber-300">
        {hint.wizardOnlyNote}
      </p>
    </div>
  );
}
