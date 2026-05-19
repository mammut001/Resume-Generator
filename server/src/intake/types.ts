export type ResumeExperience = {
  id: string;
  company: string;
  role: string;
  location?: string;
  startDate: string;
  endDate: string;
  current?: boolean;
  bullets: string[];
};

export type ResumeEducation = {
  id: string;
  school: string;
  degree: string;
  field?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  details?: string[];
};

export type ResumeSkill = {
  id: string;
  category: string;
  items: string[];
};

export type ResumeProject = {
  id: string;
  name: string;
  description: string;
  url?: string;
  bullets: string[];
};

export type ResumeData = {
  id: string;
  title: string;
  templateId: string;
  design: {
    typography: 'classic' | 'sans' | 'mono';
    density: 'compact' | 'comfortable' | 'spacious';
    pageSize: 'letter' | 'a4';
    accentColor: string;
  };
  personal: {
    fullName: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    website?: string;
    linkedin?: string;
    github?: string;
  };
  summary: string;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkill[];
  projects: ResumeProject[];
};

export type ResumeIntakeSection = 'personal' | 'summary' | 'experience' | 'education' | 'skills' | 'projects';

export type ResumeIntakeWarning = {
  code: string;
  message: string;
  fieldPath?: string;
};

export type PdfDocumentClassification = 'single_resume' | 'likely_packet' | 'uncertain';

export type PdfDocumentSignal = {
  code: string;
  message: string;
};

export type PdfDocumentPageRange = {
  start: number;
  end: number;
};

export type PdfDocumentAnalysis = {
  pageCount: number;
  extractedTextChars: number;
  classification: PdfDocumentClassification;
  signals: PdfDocumentSignal[];
  analyzedPageRange?: PdfDocumentPageRange;
};

export type ResumeIntakeResult = {
  resume: ResumeData;
  confidence: {
    overall: number;
    sections: Record<ResumeIntakeSection, number>;
  };
  warnings: ResumeIntakeWarning[];
  source: {
    kind: 'pdf' | 'paragraph';
    extractedText?: string;
  };
};

export type PdfDraftIntakeResponse = {
  kind: 'draft';
  requiresPageSelection: false;
  analysis: PdfDocumentAnalysis;
  selectedPageRange?: PdfDocumentPageRange;
  draft: ResumeIntakeResult;
};

export type PdfSelectionRequiredResponse = {
  kind: 'selection_required';
  requiresPageSelection: true;
  analysis: PdfDocumentAnalysis;
  selectedPageRange?: PdfDocumentPageRange;
  warnings: ResumeIntakeWarning[];
};

export type PdfIntakeResponse = PdfDraftIntakeResponse | PdfSelectionRequiredResponse;

export type ResumeIntakeUsage = {
  remainingAttempts: number;
  limit: number;
  resetAt: string | null;
};