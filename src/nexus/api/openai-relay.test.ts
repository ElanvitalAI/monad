import { describe, expect, test } from 'bun:test';
import { tryHandleOpenAiRelay } from './openai-relay.js';
import { getOpenAiRelaySharedSecret } from '../../config.js';
import type { GrokCredential } from '../../grok/credential.js';

const subscription: GrokCredential = {
  kind: 'subscription',
  baseUrl: 'https://subscription.example/v1',
  token: 'subscription-token',
  headers: { 'x-grok-client-version': '1.0.0' },
  source: 'auth.json',
};

function request(secret = 'shared-secret'): Request {
  return new Request('http://nexus.test/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: '{"model":"grok-4.6","messages":[{"role":"user","content":"hello"}],"stream":true}',
  });
}

describe('tryHandleOpenAiRelay', () => {
  test('shared-secret accessor defaults absent and trims a configured secret', () => {
    const original = process.env.ELANOUS_OPENAI_RELAY_SHARED_SECRET;
    try {
      delete process.env.ELANOUS_OPENAI_RELAY_SHARED_SECRET;
      expect(getOpenAiRelaySharedSecret()).toBeUndefined();
      process.env.ELANOUS_OPENAI_RELAY_SHARED_SECRET = ' shared-secret ';
      expect(getOpenAiRelaySharedSecret()).toBe('shared-secret');
    } finally {
      if (original === undefined) delete process.env.ELANOUS_OPENAI_RELAY_SHARED_SECRET;
      else process.env.ELANOUS_OPENAI_RELAY_SHARED_SECRET = original;
    }
  });

  test('missing shared-secret configuration disables the endpoint with a reason', async () => {
    const response = await tryHandleOpenAiRelay(request(), new URL('http://nexus.test/v1/chat/completions'), {
      getSharedSecret: () => undefined,
      resolveCredential: () => subscription,
    });

    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain('relay-disabled');
  });

  test('incorrect shared secret, including different-length and missing values, is rejected', async () => {
    for (const receivedSecret of ['wrong-secret', 'x', '']) {
      const response = await tryHandleOpenAiRelay(request(receivedSecret), new URL('http://nexus.test/v1/chat/completions'), {
        getSharedSecret: () => 'shared-secret',
        resolveCredential: () => subscription,
      });

      expect(response?.status).toBe(401);
      expect(await response?.text()).toContain('invalid-authentication');
    }

    const missingAuthorization = new Request('http://nexus.test/v1/chat/completions', {
      method: 'POST',
      body: '{"model":"grok-4.6"}',
    });
    const missingResponse = await tryHandleOpenAiRelay(missingAuthorization, new URL('http://nexus.test/v1/chat/completions'), {
      getSharedSecret: () => 'shared-secret',
      resolveCredential: () => subscription,
    });
    expect(missingResponse?.status).toBe(401);
    expect(await missingResponse?.text()).toContain('invalid-authentication');
  });

  test('non-subscription credential is rejected with a reason and never forwarded', async () => {
    let called = false;
    const response = await tryHandleOpenAiRelay(request(), new URL('http://nexus.test/v1/chat/completions'), {
      getSharedSecret: () => 'shared-secret',
      resolveCredential: () => ({ ...subscription, kind: 'api_key', baseUrl: 'https://api.x.ai/v1' }),
      fetch: async () => {
        called = true;
        return new Response('unexpected');
      },
    });

    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain('subscription-credential-required');
    expect(called).toBeFalse();
  });

  test('valid shared secret and subscription forward the original request body and upstream response', async () => {
    let forwardedUrl = '';
    let forwardedBody = '';
    const upstream = new Response('data: chunk\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-upstream': 'preserved' },
    });
    const response = await tryHandleOpenAiRelay(request(), new URL('http://nexus.test/v1/chat/completions'), {
      getSharedSecret: () => 'shared-secret',
      resolveCredential: () => subscription,
      fetch: async (input, init) => {
        forwardedUrl = String(input);
        forwardedBody = await new Response(init?.body).text();
        return upstream;
      },
    });

    expect(forwardedUrl).toBe('https://subscription.example/v1/chat/completions');
    expect(forwardedBody).toBe('{"model":"grok-4.6","messages":[{"role":"user","content":"hello"}],"stream":true}');
    expect(response).toBe(upstream);
    expect(response?.headers.get('x-upstream')).toBe('preserved');
    expect(await response?.text()).toBe('data: chunk\n\n');
  });

  test('upstream errors are returned without exposing a stack trace', async () => {
    const response = await tryHandleOpenAiRelay(request(), new URL('http://nexus.test/v1/chat/completions'), {
      getSharedSecret: () => 'shared-secret',
      resolveCredential: () => subscription,
      fetch: async () => new Response('{"error":"upstream unavailable"}', { status: 429 }),
    });

    expect(response?.status).toBe(429);
    expect(await response?.text()).toBe('{"error":"upstream unavailable"}');
  });
});
