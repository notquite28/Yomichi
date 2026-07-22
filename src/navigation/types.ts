export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Settings: undefined;
  Diagnostics: undefined;
  RadicalImagePreview: undefined;
  ReviewSession:
    | {
        practiceSource?:
          | 'recentMistakes'
          | 'apprenticeLeeches'
          | 'allLeeches'
          | 'burnedItems'
          | 'subjectIds';
        subjectIds?: number[];
      }
    | undefined;
  WeakSpotClinic: undefined;
  LessonSession: { selectedIds?: number[] };
  LessonPicker: undefined;
  SubjectCatalog: { level: number };
  SubjectSearch: undefined;
  SubjectBrowse: { title: string; srsMin?: number; srsMax?: number; excluded?: boolean; remaining?: boolean };
  BurnedItems: undefined;
  SubjectDetail: { subjectId: number };
};
