import { describe, expect, test } from 'bun:test';

import {
  deriveInputOwner,
  deriveInputOwnershipSnapshot,
  isChatMainSuppressed,
  isVwLocalComposerSuppressed,
} from '../src/dashboard/input/input-owner.js';

describe('dashboard input owner priority', () => {
  test('question view wins over every existing input candidate while active', () => {
    const state = {
      chatMainFocused: true,
      chatMainAvailable: true,
      vwLocalComposerActive: true,
      overlayInputActive: true,
      questionActive: true,
    };
    expect(deriveInputOwner(state)).toBe('question-view');
    expect(deriveInputOwnershipSnapshot(state)).toEqual({
      owner: 'question-view',
      chatMainSuppressed: true,
      vwLocalComposerSuppressed: true,
    });
  });

  test('question inactive preserves existing ownership results', () => {
    expect(deriveInputOwner({
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: true,
      questionActive: false,
    })).toBe('overlay-input');
    expect(deriveInputOwner({
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: false,
      questionActive: false,
    })).toBe('vw-local-composer');
    expect(deriveInputOwner({
      chatMainFocused: true,
      vwLocalComposerActive: false,
      overlayInputActive: false,
      questionActive: false,
    })).toBe('chat-main');
    expect(deriveInputOwner({
      chatMainFocused: false,
      vwLocalComposerActive: false,
      overlayInputActive: false,
      questionActive: false,
    })).toBe('none');
  });

  test('question view clears back to the current underlying owner without cached state', () => {
    const active = {
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: false,
      questionActive: true,
    };
    expect(deriveInputOwner(active)).toBe('question-view');
    expect(deriveInputOwner({ ...active, questionActive: false })).toBe('vw-local-composer');
  });

  test('overlay input wins over vw local composer and chat-main', () => {
    const state = {
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: true,
    };
    expect(deriveInputOwner(state)).toBe('overlay-input');
    expect(isChatMainSuppressed(state)).toBe(true);
    expect(isVwLocalComposerSuppressed(state)).toBe(true);
  });

  test('vw local composer wins over chat-main when no overlay input is active', () => {
    const state = {
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: false,
    };
    expect(deriveInputOwner(state)).toBe('vw-local-composer');
    expect(isChatMainSuppressed(state)).toBe(true);
    expect(isVwLocalComposerSuppressed(state)).toBe(false);
  });

  test('chat-main owns input when it is focused and no higher-priority owner is active', () => {
    const state = {
      chatMainFocused: true,
      vwLocalComposerActive: false,
      overlayInputActive: false,
    };
    expect(deriveInputOwner(state)).toBe('chat-main');
    expect(isChatMainSuppressed(state)).toBe(false);
    expect(isVwLocalComposerSuppressed(state)).toBe(true);
  });

  test('chat-main cannot own input when the current workspace does not expose host input', () => {
    const state = {
      chatMainFocused: true,
      chatMainAvailable: false,
      vwLocalComposerActive: false,
      overlayInputActive: false,
    };
    expect(deriveInputOwner(state)).toBe('none');
    expect(isChatMainSuppressed(state)).toBe(true);
  });

  test('owner restores to vw local composer after overlay input closes', () => {
    expect(deriveInputOwner({
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: true,
    })).toBe('overlay-input');
    expect(deriveInputOwner({
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: false,
    })).toBe('vw-local-composer');
  });

  test('ownership snapshot keeps restore semantics in one seam', () => {
    expect(deriveInputOwnershipSnapshot({
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: true,
    })).toEqual({
      owner: 'overlay-input',
      chatMainSuppressed: true,
      vwLocalComposerSuppressed: true,
    });
    expect(deriveInputOwnershipSnapshot({
      chatMainFocused: true,
      vwLocalComposerActive: true,
      overlayInputActive: false,
    })).toEqual({
      owner: 'vw-local-composer',
      chatMainSuppressed: true,
      vwLocalComposerSuppressed: false,
    });
    expect(deriveInputOwnershipSnapshot({
      chatMainFocused: true,
      vwLocalComposerActive: false,
      overlayInputActive: false,
    })).toEqual({
      owner: 'chat-main',
      chatMainSuppressed: false,
      vwLocalComposerSuppressed: true,
    });
  });
});
