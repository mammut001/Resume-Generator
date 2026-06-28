import { TranslationError } from './formatError';
import { throwApiError } from './apiErrors';
import { PdfIntakeResponse, ResumeIntakeResult, ResumeIntakeUsage } from '@/types/resume';

const intakeEndpoint = (import.meta.env.VITE_RESUME_INTAKE_ENDPOINT || '/api/intake').replace(/\/$/, '');

export async function getIntakeUsage(): Promise<ResumeIntakeUsage> {
  const response = await fetch(`${intakeEndpoint}/usage`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    await throwApiError(response, 'errors.intakeRequestFailed');
  }

  return response.json();
}

export async function generateResumeFromText(text: string): Promise<ResumeIntakeResult> {
  const response = await fetch(`${intakeEndpoint}/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    await throwApiError(response, 'errors.intakeRequestFailed');
  }

  return response.json();
}

export async function generateResumeFromPdf(
  file: File,
  options?: { pageStart?: number; pageEnd?: number },
): Promise<PdfIntakeResponse> {
  const formData = new FormData();
  formData.set('file', file);

  if ((options?.pageStart === undefined) !== (options?.pageEnd === undefined)) {
    throw new TranslationError('errors.pdfPageRangeRequired');
  }

  if (typeof options?.pageStart === 'number' && typeof options.pageEnd === 'number') {
    formData.set('pageStart', String(options.pageStart));
    formData.set('pageEnd', String(options.pageEnd));
  }

  const response = await fetch(`${intakeEndpoint}/pdf`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    await throwApiError(response, 'errors.intakeRequestFailed');
  }

  return response.json();
}