import type { ResumeData } from '../intake/types.js';

export type ResumeTailoringSection = 'summary' | 'experience' | 'skills' | 'projects';

export type ResumeTailoringChangeKind = 'rewritten' | 'reordered' | 'removed' | 'emphasized';

export type ResumeTailoringChange = {
  id: string;
  section: ResumeTailoringSection;
  kind: ResumeTailoringChangeKind;
  description: string;
  targetPath?: string;
  before?: string;
  after?: string;
  reason?: string;
};

export type ResumeTailoringWarning = {
  code: string;
  message: string;
  fieldPath?: string;
  requirement?: string;
};

export type ResumeTailoringResult = {
  tailoredResume: ResumeData;
  summary: {
    targetRole?: string;
    keyRequirements: string[];
    matchedStrengths: string[];
    gaps: string[];
  };
  changes: ResumeTailoringChange[];
  warnings: ResumeTailoringWarning[];
};

export type ResumeTailoringUsage = {
  remainingAttempts: number;
  limit: number;
  resetAt: string | null;
};