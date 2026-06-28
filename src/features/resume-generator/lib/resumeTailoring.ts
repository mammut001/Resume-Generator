import type { ResumeData, ResumeTailoringResult, ResumeTailoringUsage } from '@/types/resume';
import { throwApiError } from './apiErrors';

const tailoringEndpoint = (import.meta.env.VITE_RESUME_TAILORING_ENDPOINT || '/api/tailor').replace(/\/$/, '');

export async function getTailoringUsage(): Promise<ResumeTailoringUsage> {
  const response = await fetch(`${tailoringEndpoint}/usage`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    await throwApiError(response, 'errors.tailoringRequestFailed');
  }

  return response.json();
}

export async function generateTailoredResume(resume: ResumeData, jobDescription: string): Promise<ResumeTailoringResult> {
  const response = await fetch(`${tailoringEndpoint}/resume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ resume, jobDescription }),
  });

  if (!response.ok) {
    await throwApiError(response, 'errors.tailoringRequestFailed');
  }

  return response.json();
}