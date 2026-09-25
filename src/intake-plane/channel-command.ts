import { createHash } from 'node:crypto';
import { debug } from '../debug/log.js';
import { createTextChannelIntakeRecord } from './adapters/text.js';
import { buildIntakePresentationLines } from './presenter.js';
import { getIntakeStore } from './runtime.js';
import { ingestIntakeRecord, type IntakeIngestPolicy, type IntakeIngestResult } from './service.js';
import { INTAKE_SLASH_SUBCOMMANDS, resolveIntakeSlash } from './slash.js';
import type { IntakeStore } from './store.js';
import type { NormalizedAttachment } from '../acp/content-blocks.js';

type IntakeCommandSurface = 'telegram' | 'discord';

interface ChannelCommandContext {
  surface: IntakeCommandSurface;
  source: 'telegram' | 'discord';
  text: string;
  actor?: {
    id?: string;
    display?: string;
  };
  attachments?: NormalizedAttachment[];
  channelContext?: {
    chatId?: string;
    guildId?: string;
    threadId?: string;
    deviceId?: string;
  };
  receivedAt?: string;
  store?: IntakeStore;
  now?: () => Date;
  createIntakeId?: () => string;
}

// ⛔⭐ 손으로 적은 사본을 두지 않는다 — 이 목록은 «슬래시가 분기하는 것」과 «같아야» 하고,
//   사본을 두면 늙는다. 📏 2026-08-31 실측: 이 사본이 9개인 동안 슬래시는 16개가 됐고,
//   차이 일곱(draft·events·help·implement·replay·search·show)이 «조용히 인라인 capture 로»
//   떨어졌다 — 거부도 오류도 아니라 「다른 일」을 했다.
const EXISTING_SESSION_SUBCOMMANDS = INTAKE_SLASH_SUBCOMMANDS;

function defaultIntakeId(now: Date): string {
  return `intake-${now.toISOString().replace(/[:.]/g, '-').toLowerCase()}`;
}

function intakeTextMetadata(text: string): { textLength: number; textHash: string } {
  return {
    textLength: text.length,
    textHash: createHash('sha256').update(text).digest('hex'),
  };
}

function renderIntakeSummary(
  surface: IntakeCommandSurface,
  result: IntakeIngestResult,
): string {
  return buildIntakePresentationLines(result.session, surface, {
    heading: `Intake: ${result.intakeId} [${result.state}]`,
    trailingOutput: result.output,
  }).join('\n');
}

function parseInlineCapture(
  args: string[],
): { policy: IntakeIngestPolicy; text: string } | { error: string } {
  if (args.length === 0) return { error: 'Usage: intake <text...> | intake now -- <text...> | intake backlog -- <text...> | intake when <schedule> -- <text...>' };
  const head = args[0]!.toLowerCase();
  if (head === 'now' || head === 'backlog' || head === 'later' || head === 'when') {
    if (head === 'when') {
      const divider = args.indexOf('--');
      if (divider < 2 || divider === args.length - 1) {
        return { error: 'Usage: intake when <scheduleText> -- <text...>' };
      }
      const scheduleText = args.slice(1, divider).join(' ').trim();
      const text = args.slice(divider + 1).join(' ').trim();
      if (!scheduleText || !text) return { error: 'Usage: intake when <scheduleText> -- <text...>' };
      return {
        policy: { mode: 'schedule-followup', scheduleText },
        text,
      };
    }
    const text = args.slice(1).join(' ').replace(/^--\s*/, '').trim();
    if (!text) {
      return {
        error: `Usage: intake ${head} <text...>`,
      };
    }
    return {
      policy: {
        mode: head === 'now'
          ? 'apply-now'
          : head === 'backlog'
            ? 'backlog-only'
            : 'review',
      },
      text,
    };
  }
  return {
    policy: { mode: 'review' },
    text: args.join(' ').trim(),
  };
}

export async function handleTextChannelIntakeCommand(
  args: string[],
  ctx: ChannelCommandContext,
): Promise<string> {
  const store = ctx.store ?? getIntakeStore();
  const now = ctx.now?.() ?? new Date();
  const head = (args[0] ?? '').toLowerCase();
  if (EXISTING_SESSION_SUBCOMMANDS.has(head)) {
    debug.log('intake-plane.channel', 'existing-session-command', {
      source: ctx.source,
      surface: ctx.surface,
      subcommand: head,
      ...intakeTextMetadata(head),
    });
    const slash = await resolveIntakeSlash(args, {
      store,
      now: () => now,
      createIntakeId: ctx.createIntakeId,
    });
    return slash.output;
  }
  const parsedInline = parseInlineCapture(args);
  if ('error' in parsedInline) return parsedInline.error;
  if ('policy' in parsedInline) {
    const intakeId = ctx.createIntakeId?.() ?? defaultIntakeId(now);
    const metadata = intakeTextMetadata(parsedInline.text);
    debug.log('intake-plane.channel', 'received', {
      source: ctx.source,
      surface: ctx.surface,
      intakeId,
      ...metadata,
    });
    const result = await ingestIntakeRecord(
      store,
      createTextChannelIntakeRecord({
        intakeId,
        source: ctx.source,
        text: parsedInline.text,
        receivedAt: ctx.receivedAt ?? now.toISOString(),
        attachments: ctx.attachments,
        actor: ctx.actor,
        channelContext: ctx.channelContext,
      }),
      parsedInline.policy,
    );
    debug.log('intake-plane.channel', 'ingested', {
      source: ctx.source,
      surface: ctx.surface,
      intakeId: result.intakeId,
      state: result.state,
      ...metadata,
    });
    return renderIntakeSummary(ctx.surface, result);
  }
  const slash = await resolveIntakeSlash(args, {
    store,
    now: () => now,
    createIntakeId: ctx.createIntakeId,
  });
  return slash.output;
}
