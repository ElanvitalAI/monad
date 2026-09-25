import { createHash } from 'node:crypto';
import { debug } from '../debug/log.js';
import { createIntakeStore, type IntakeStore } from './store.js';

let currentStore: IntakeStore | null = null;

export function getIntakeStore(): IntakeStore {
  if (!currentStore) {
    currentStore = createIntakeStore({ replayOnInit: true });
    debug.log('intake-plane.runtime', 'store-ready', {
      source: 'runtime',
      stage: 'store-ready',
      textLength: 0,
      textHash: createHash('sha256').update('').digest('hex'),
    });
  }
  return currentStore;
}

export function setIntakeStoreForTest(store: IntakeStore | null): void {
  currentStore = store;
}
