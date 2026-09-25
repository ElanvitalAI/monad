// Slash command: /persona [list|use <id>]
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.2)
//
// 'list' → show the persona catalog (embed). 'use <id>' → switch the
// active persona for the channel (caller-supplied via ctx).

import { buildPersonaEmbed } from '../embed-builder.js';
import {
  OPT_STRING, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCommandSchema, type SlashHandler,
} from '../slash-types.js';
import type { PersonaProfile } from '../../persona/types.js';

export const PERSONA_SCHEMA: SlashCommandSchema = {
  name: 'persona',
  description: 'List or switch the active persona for this channel',
  options: [
    {
      name: 'action',
      description: 'list | use',
      type: OPT_STRING,
      required: true,
      choices: [
        { name: 'list', value: 'list' },
        { name: 'use', value: 'use' },
      ],
    },
    {
      name: 'persona_id',
      description: 'Persona id (required for "use")',
      type: OPT_STRING,
      required: false,
    },
  ],
  dmPermission: false,
};

export interface PersonaCtx {
  /** Read-only persona catalog. */
  readonly listPersonas: () => readonly PersonaProfile[];
  readonly getPersona: (id: string) => PersonaProfile | undefined;
  /** Caller binds the actual "switch active persona" side effect. */
  readonly setActivePersona?: (channelId: string, personaId: string) => Promise<void>;
}

export const personaHandler: SlashHandler<PersonaCtx> = async (interaction, ctx) => {
  const action = interaction.options.get('action');
  if (action === 'list') {
    const list = ctx.listPersonas();
    if (list.length === 0) {
      return {
        type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
        content: '_(no personas registered — add `personas/<id>.yaml`)_',
        ephemeral: true,
      };
    }
    const embeds = list.slice(0, 10).map((p) => buildPersonaEmbed(p, {
      title: p.displayName,
      description: p.description ?? '_(no description)_',
      footerText: p.models?.primary ?? p.brand ?? '',
    }) as unknown as Record<string, unknown>);
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `🎭 ${list.length} persona(s) registered:`,
      embeds,
      ephemeral: true,
    };
  }

  if (action === 'use') {
    const id = interaction.options.get('persona_id');
    if (typeof id !== 'string' || !id) {
      return {
        type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
        content: '⚠️ `persona_id` required for `use`',
        ephemeral: true,
      };
    }
    const persona = ctx.getPersona(id);
    if (!persona) {
      return {
        type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
        content: `⚠️ persona '${id}' not found · /persona list 로 확인`,
        ephemeral: true,
      };
    }
    if (ctx.setActivePersona) {
      await ctx.setActivePersona(interaction.channelId, id);
    }
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `✅ active persona set to **${persona.displayName}** (${id})`,
    };
  }

  return {
    type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
    content: '⚠️ unknown action — use `list` or `use`',
    ephemeral: true,
  };
};

export const personaCommand: BoundSlashCommand<PersonaCtx> = {
  schema: PERSONA_SCHEMA,
  handler: personaHandler,
};
