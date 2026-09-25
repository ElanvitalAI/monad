import { describe, expect, it } from 'bun:test';
import { selectDashboardChatErrorDetail } from '../src/dashboard/input/chat-main-plain-turn-runtime.js';

describe('selectDashboardChatErrorDetail', () => {
  it('prefers and redacts JSON-RPC data.details', () => {
    const detail = selectDashboardChatErrorDetail({
      code: -32603,
      message: 'Internal error',
      data: {
        details: 'Anthropic API 401 invalid x-api-key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      },
    });

    expect(detail).toContain('Anthropic API 401 invalid x-api-key: ***');
    expect(detail).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  });

  it('prefers details attached to a JSON-RPC Error instance', () => {
    const error = Object.assign(new Error('Internal error'), {
      code: -32603,
      data: { details: 'LLM API 400 Incorrect API key provided' },
    });

    expect(selectDashboardChatErrorDetail(error)).toBe('LLM API 400 Incorrect API key provided');
  });

  it('preserves the message when data.details is not a standard JSON-RPC internal error', () => {
    expect(selectDashboardChatErrorDetail({
      code: -32000,
      message: 'Request rejected',
      data: { details: 'do not replace this message' },
    })).toBe('Request rejected');
    expect(selectDashboardChatErrorDetail({
      code: -32603,
      message: 'Different error',
      data: { details: 'do not replace this message either' },
    })).toBe('Different error');
  });

  it('preserves the message from ordinary Error values', () => {
    expect(selectDashboardChatErrorDetail(new Error('stream exploded'))).toBe('stream exploded');
  });

  it('falls back to String(err) for non-envelope errors with an empty message', () => {
    expect(selectDashboardChatErrorDetail({ message: '', toString: () => 'fallback reason' }))
      .toBe('fallback reason');
  });

  it('preserves string error values', () => {
    expect(selectDashboardChatErrorDetail('connection lost')).toBe('connection lost');
  });
});
