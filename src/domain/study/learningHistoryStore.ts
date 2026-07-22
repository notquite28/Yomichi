import { create } from 'zustand';

type LearningHistoryState = {
  revision: number;
  bumpRevision: () => void;
};

export const useLearningHistoryStore = create<LearningHistoryState>((set) => ({
  revision: 0,
  bumpRevision: () => set((state) => ({ revision: state.revision + 1 })),
}));
