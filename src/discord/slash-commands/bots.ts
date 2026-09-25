import { botCommandDeclarations, dispatchBotCommand, type BotCommandDeclaration } from '../../bots/command-surface.js';
import {
  OPT_STRING, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCommandSchema,
} from '../slash-types.js';

function toDiscordSchema(command: BotCommandDeclaration): SlashCommandSchema {
  return {
    name: command.name,
    description: command.description,
    options: command.arguments.map((argument) => ({
      name: argument.name,
      description: argument.description,
      type: OPT_STRING,
      required: argument.required,
    })),
  };
}

/** Convert the surface-neutral bot declarations for Discord registration and dispatch. */
export function botCommandsToDiscord(
  declarations: readonly BotCommandDeclaration[] = botCommandDeclarations,
): BoundSlashCommand[] {
  return declarations.map((command) => ({
    schema: toDiscordSchema(command),
    handler: async (interaction) => ({
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      // 🔭⛔ **핸들러를 «직접» 부르지 않는다** — 그러면 이 표면의 호출이 관측에 «안 남는다»
      //    (2026-09-02 · 43차 실측: 디스코드는 살아 있고 봇 명령 여섯이 등록돼 있는데 계측이 0건이었다).
      content: await dispatchBotCommand(command, command.arguments.map((argument) => {
        const value = interaction.options.get(argument.name);
        return typeof value === 'string' ? value : '';
      }), {
        surface: 'discord',
        // ⛔ 이 표면은 opts 를 «안 준다» — 「없다」가 사실이므로 false 다(지어낸 값이 아니다).
        hasOpts: false,
        // ⛔ `canSendImage` 는 «안 싣는다» — 이 표면의 그림 능력을 우리가 «안 쟀다».
        //    ⭐ 이제 «타입»이 그것을 막는다(`canSendImage?: never`) — 주석이 아니라 갈래 타입이다.
      }),
      ephemeral: true,
    }),
  }));
}

export const botCommands = botCommandsToDiscord();
