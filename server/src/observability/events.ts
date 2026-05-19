import type { PdfDocumentPageRange, ResumeIntakeWarning } from '../intake/types.js';
import type { ResumeTailoringWarning } from '../tailoring/types.js';

const intakeModelFailureCodes = new Set(['MODEL_GATEWAY_FAILED', 'MODEL_GATEWAY_NOT_CONFIGURED']);
const tailoringModelFailureCodes = new Set(['TAILORING_MODEL_GATEWAY_FAILED', 'TAILORING_MODEL_GATEWAY_NOT_CONFIGURED']);

export function bucketTextLength(length: number): string {
  return bucketLength(length);
}

export function bucketJobDescriptionLength(length: number): string {
  return bucketLength(length);
}

export function getIntakeWarningCodes(warnings: ResumeIntakeWarning[]): string[] {
  return uniqueCodes(warnings.map(warning => warning.code));
}

export function getTailoringWarningCodes(warnings: ResumeTailoringWarning[]): string[] {
  return uniqueCodes(warnings.map(warning => warning.code));
}

export function inferIntakeUsedModel(warnings: ResumeIntakeWarning[]): boolean {
  return !warnings.some(warning => intakeModelFailureCodes.has(warning.code));
}

export function inferTailoringUsedModel(warnings: ResumeTailoringWarning[]): boolean {
  return !warnings.some(warning => tailoringModelFailureCodes.has(warning.code));
}

export function countSelectedPages(selectedPageRange: PdfDocumentPageRange | undefined, pageCount: number): number {
  if (!selectedPageRange) return pageCount;
  return Math.max((selectedPageRange.end - selectedPageRange.start) + 1, 0);
}

export function shouldRecordValidationFailure(statusCode: number, errorCode: string): boolean {
  return statusCode >= 400
    && statusCode < 500
    && errorCode !== 'NOT_FOUND'
    && errorCode !== 'METHOD_NOT_ALLOWED'
    && errorCode !== 'QUOTA_EXCEEDED';
}

function uniqueCodes(codes: string[]): string[] {
  return Array.from(new Set(codes.filter(Boolean)));
}

function bucketLength(length: number): string {
  if (length < 100) return '0-99';
  if (length < 500) return '100-499';
  if (length < 2_000) return '500-1999';
  if (length < 5_000) return '2000-4999';
  return '5000+';
}