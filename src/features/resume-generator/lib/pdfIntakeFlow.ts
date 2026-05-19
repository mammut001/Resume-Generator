import type { PdfDocumentAnalysis, ResumeData } from '@/types/resume';

export type PdfPageRangeValidationError = 'missing' | 'integer' | 'order' | 'bounds';

export type PdfPageRangeValidationResult =
  | {
      ok: true;
      pageRange: {
        pageStart: number;
        pageEnd: number;
      };
    }
  | {
      ok: false;
      error: PdfPageRangeValidationError;
    };

export function applyIntakeDraftToResume(currentResume: ResumeData, draftResume: ResumeData): ResumeData {
  return {
    ...draftResume,
    design: currentResume.design,
    templateId: currentResume.templateId,
  };
}

export function validatePdfPageRange(pageStartInput: string, pageEndInput: string, pageCount: number): PdfPageRangeValidationResult {
  const normalizedStart = pageStartInput.trim();
  const normalizedEnd = pageEndInput.trim();

  if (!normalizedStart || !normalizedEnd) {
    return { ok: false, error: 'missing' };
  }

  if (!/^\d+$/.test(normalizedStart) || !/^\d+$/.test(normalizedEnd)) {
    return { ok: false, error: 'integer' };
  }

  const pageStart = Number.parseInt(normalizedStart, 10);
  const pageEnd = Number.parseInt(normalizedEnd, 10);

  if (!Number.isSafeInteger(pageStart) || !Number.isSafeInteger(pageEnd) || pageStart < 1 || pageEnd < 1) {
    return { ok: false, error: 'integer' };
  }

  if (pageStart > pageEnd) {
    return { ok: false, error: 'order' };
  }

  if (pageEnd > pageCount) {
    return { ok: false, error: 'bounds' };
  }

  return {
    ok: true,
    pageRange: {
      pageStart,
      pageEnd,
    },
  };
}

export function getPdfAnalysisTone(analysis: PdfDocumentAnalysis | null | undefined): 'normal' | 'review' | 'blocked' {
  if (!analysis) return 'normal';
  if (analysis.classification === 'likely_packet') return 'blocked';
  if (analysis.classification === 'uncertain') return 'review';
  return 'normal';
}