import { describe, it, expect } from 'bun:test';
import { toLmsGetArg } from './installer.js';

describe('toLmsGetArg — lms get 인자 정규화(HF repo → 전체 URL)', () => {
  it('HF repo id(org/model) → 전체 HF URL (카탈로그 소문자화 우회)', () => {
    expect(toLmsGetArg('mlx-community/Ornith-1.0-35B-4bit')).toBe('https://huggingface.co/mlx-community/Ornith-1.0-35B-4bit');
    expect(toLmsGetArg('deepreinforce-ai/Ornith-1.0-9B')).toBe('https://huggingface.co/deepreinforce-ai/Ornith-1.0-9B');
  });
  it('이미 URL 이면 그대로', () => {
    expect(toLmsGetArg('https://huggingface.co/mlx-community/Ornith-1.0-9B-4bit')).toBe('https://huggingface.co/mlx-community/Ornith-1.0-9B-4bit');
  });
  it('카탈로그 검색어(공백·슬래시 없음)는 그대로', () => {
    expect(toLmsGetArg('qwen3-coder')).toBe('qwen3-coder');
    expect(toLmsGetArg('Qwen3 Coder 30B')).toBe('Qwen3 Coder 30B');
  });
  it('org/model@quant(lms 네이티브 quant 표기)는 변환 안 함', () => {
    expect(toLmsGetArg('qwen/qwen3.5-9b@q8_0')).toBe('qwen/qwen3.5-9b@q8_0');
  });
});
