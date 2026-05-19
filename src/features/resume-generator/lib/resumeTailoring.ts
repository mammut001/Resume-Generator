import type { ResumeData, ResumeTailoringResult, ResumeTailoringUsage } from '@/types/resume';

const tailoringEndpoint = (import.meta.env.VITE_RESUME_TAILORING_ENDPOINT || '/api/tailor').replace(/\/$/, '');

export async function getTailoringUsage(): Promise<ResumeTailoringUsage> {
  const response = await fetch(`${tailoringEndpoint}/usage`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(await readTailoringError(response));
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
    throw new Error(await readTailoringError(response));
  }

  return response.json();
}

async function readTailoringError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = payload?.error;

  if (typeof error === 'string') return error;
  if (error?.message) return error.message;

  return `Tailoring request failed with status ${response.status}`;
}