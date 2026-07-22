import { create } from 'zustand';

import {
  getCoachStatus,
  getDownloadProgress,
  getLastError,
  initCoachStatus,
  subscribeCoach,
} from './coachService';
import type { CoachStatus } from './types';

export type CoachStoreState = {
  status: CoachStatus;
  downloadProgress: number | null;
  lastError: string | null;
  refresh: () => void;
};

function snapshot(): Pick<CoachStoreState, 'status' | 'downloadProgress' | 'lastError'> {
  return {
    status: getCoachStatus(),
    downloadProgress: getDownloadProgress(),
    lastError: getLastError(),
  };
}

export const useCoachStore = create<CoachStoreState>((set) => ({
  ...snapshot(),
  refresh: () => set(snapshot()),
}));

let unsub: (() => void) | null = null;

export function bindCoachStore(): () => void {
  if (unsub) {
    return unsub;
  }
  void initCoachStatus().then(() => {
    useCoachStore.getState().refresh();
  });
  unsub = subscribeCoach(() => {
    useCoachStore.getState().refresh();
  });
  return () => {
    unsub?.();
    unsub = null;
  };
}

// Auto-bind for app runtime; tests can ignore.
bindCoachStore();
