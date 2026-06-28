import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultResumeWorkspace,
  resetPersistenceFailureNotification,
  saveResumeWorkspace,
  shouldNotifyPersistenceFailure,
} from '@/features/resume-generator/lib/resumePersistence';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('saveResumeWorkspace', () => {
  beforeEach(() => {
    localStorageMock.clear();
    resetPersistenceFailureNotification();
  });

  it('returns true when persistence succeeds', () => {
    const workspace = createDefaultResumeWorkspace('en');
    expect(saveResumeWorkspace(workspace)).toBe(true);
  });

  it('returns false and allows one notification when persistence fails', () => {
    const workspace = createDefaultResumeWorkspace('en');
    vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(saveResumeWorkspace(workspace)).toBe(false);
    expect(shouldNotifyPersistenceFailure()).toBe(true);
    expect(shouldNotifyPersistenceFailure()).toBe(false);
  });
});