import { describe, expect, test } from 'bun:test';
import {
  parseQuestionRequest,
  MAX_QUESTIONS, MIN_OPTIONS_PER_QUESTION, MAX_OPTIONS_PER_QUESTION, MAX_HEADER_LENGTH,
} from '../../src/ask-user-question/index.js';

function okShape(): Record<string, unknown> {
  return {
    questions: [
      {
        id: 'auth_method',
        header: 'Auth',
        question: 'Which auth method?',
        options: [
          { label: 'OAuth', description: 'Delegated identity' },
          { label: 'JWT', description: 'Self-contained token' },
        ],
      },
    ],
  };
}

describe('parseQuestionRequest — happy path', () => {
  test('minimal valid input round-trips', () => {
    const r = parseQuestionRequest(okShape());
    expect(r.ok).toBe(true);
    if (r.ok !== true) throw new Error();
    expect(r.req.questions).toHaveLength(1);
    expect(r.req.questions[0]!.id).toBe('auth_method');
    expect(r.req.questions[0]!.options).toHaveLength(2);
  });

  test('includeOther defaults to true', () => {
    const r = parseQuestionRequest(okShape());
    if (r.ok !== true) throw new Error();
    expect(r.req.questions[0]!.includeOther).toBe(true);
  });

  test('includeOther:false is preserved', () => {
    const shape = okShape();
    (shape.questions as any[])[0].includeOther = false;
    const r = parseQuestionRequest(shape);
    if (r.ok !== true) throw new Error();
    expect(r.req.questions[0]!.includeOther).toBe(false);
  });

  test('multiSelect:true flag preserved', () => {
    const shape = okShape();
    (shape.questions as any[])[0].multiSelect = true;
    const r = parseQuestionRequest(shape);
    if (r.ok !== true) throw new Error();
    expect(r.req.questions[0]!.multiSelect).toBe(true);
  });

  test('preview on an option is kept', () => {
    const shape = okShape();
    (shape.questions as any[])[0].options[0].preview = '```ts\nfoo()```';
    const r = parseQuestionRequest(shape);
    if (r.ok !== true) throw new Error();
    expect(r.req.questions[0]!.options[0]!.preview).toContain('foo');
  });
});

describe('parseQuestionRequest — validation', () => {
  test('empty questions array rejected', () => {
    const r = parseQuestionRequest({ questions: [] });
    expect(r.ok).toBe(false);
  });

  test(`> ${MAX_QUESTIONS} questions rejected`, () => {
    const shape = okShape();
    const base = (shape.questions as any[])[0];
    shape.questions = [{ ...base, id: 'a' }, { ...base, id: 'b' }, { ...base, id: 'c' }, { ...base, id: 'd' }];
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
    if (r.ok === true) throw new Error();
    expect(r.reason).toContain('at most');
  });

  test('duplicate ids rejected', () => {
    const shape = okShape();
    const base = (shape.questions as any[])[0];
    shape.questions = [{ ...base }, { ...base }];  // same id
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
    if (r.ok === true) throw new Error();
    expect(r.reason).toContain('duplicated');
  });

  test('missing id rejected', () => {
    const shape = okShape();
    delete (shape.questions as any[])[0].id;
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
  });

  test(`header > ${MAX_HEADER_LENGTH} chars rejected`, () => {
    const shape = okShape();
    (shape.questions as any[])[0].header = 'a'.repeat(MAX_HEADER_LENGTH + 1);
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
    if (r.ok === true) throw new Error();
    expect(r.reason).toContain('≤');
  });

  test('empty question text rejected', () => {
    const shape = okShape();
    (shape.questions as any[])[0].question = '   ';
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
  });

  test(`< ${MIN_OPTIONS_PER_QUESTION} options rejected`, () => {
    const shape = okShape();
    (shape.questions as any[])[0].options = [
      { label: 'Only', description: 'Just one' },
    ];
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
  });

  test(`> ${MAX_OPTIONS_PER_QUESTION} options rejected`, () => {
    const shape = okShape();
    (shape.questions as any[])[0].options = Array.from({ length: 5 }, (_, i) => ({
      label: `O${i}`, description: `d${i}`,
    }));
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
  });

  test('option missing label rejected', () => {
    const shape = okShape();
    (shape.questions as any[])[0].options[0].label = '';
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
  });

  test('option missing description rejected', () => {
    const shape = okShape();
    (shape.questions as any[])[0].options[0].description = '';
    const r = parseQuestionRequest(shape);
    expect(r.ok).toBe(false);
  });

  test('non-object input rejected', () => {
    expect(parseQuestionRequest({} as any).ok).toBe(false);
    expect(parseQuestionRequest({ questions: 'nope' } as any).ok).toBe(false);
  });
});
