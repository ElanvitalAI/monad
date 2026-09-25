import { describe, expect, test } from 'bun:test';

import { parseOscNotify } from '../src/preview/terminal.js';

describe('parseOscNotify', () => {
  test('OSC 9 is title-only', () => {
    const r = parseOscNotify(9, 'Build succeeded');
    expect(r).toEqual({ code: 9, title: 'Build succeeded', body: '', raw: 'Build succeeded' });
  });

  test('OSC 777 notify;title;body', () => {
    const r = parseOscNotify(777, 'notify;CI;Green');
    expect(r.title).toBe('CI');
    expect(r.body).toBe('Green');
  });

  test('OSC 777 body with embedded semicolons preserves them', () => {
    const r = parseOscNotify(777, 'notify;Title;body with ; semicolons');
    expect(r.body).toBe('body with ; semicolons');
  });

  test('OSC 777 without notify prefix falls back to title', () => {
    const r = parseOscNotify(777, 'file:/tmp/whatever.png');
    expect(r.title).toBe('file:/tmp/whatever.png');
    expect(r.body).toBe('');
  });

  test('OSC 99 pulls n= or d= as title', () => {
    const r1 = parseOscNotify(99, 'd=123,n=Claude;Permission needed');
    expect(r1.title).toBe('Claude');
    expect(r1.body).toBe('Permission needed');

    const r2 = parseOscNotify(99, 'd=foo;hello');
    expect(r2.title).toBe('foo');
    expect(r2.body).toBe('hello');
  });

  test('OSC 99 without named keys falls back to body', () => {
    const r = parseOscNotify(99, 'x=1,y=2;stuff');
    expect(r.title).toBe('stuff');
  });
});
