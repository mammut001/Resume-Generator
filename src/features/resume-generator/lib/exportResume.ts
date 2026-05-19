import { ResumeData } from '@/types/resume';

export async function exportPdf(resume: ResumeData, pdfBlob: Blob | undefined, documentTitle?: string): Promise<string> {
  if (!pdfBlob) {
    throw new Error('No PDF available to export');
  }

  const fileName = buildResumeExportFileName(resume, 'pdf', documentTitle);
  downloadBlob(pdfBlob, fileName);
  return fileName;
}

export async function copyTypstSource(typstSource: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(typstSource);
  } catch {
    throw new Error('Failed to copy to clipboard');
  }
}

export function downloadTypstSource(typstSource: string, resume: ResumeData, documentTitle?: string): string {
  const fileName = buildResumeExportFileName(resume, 'typ', documentTitle);
  const blob = new Blob([typstSource], { type: 'text/plain' });
  downloadBlob(blob, fileName);
  return fileName;
}

export function buildResumeExportFileName(resume: ResumeData, extension: 'pdf' | 'typ', documentTitle?: string): string {
  const candidateName = slugify(resume.personal.fullName);
  const descriptor = slugify(documentTitle || resume.title || resume.personal.headline);
  const fallbackDescriptor = slugify(resume.personal.headline || resume.title);
  const parts = [candidateName, descriptor || fallbackDescriptor].filter(Boolean);
  const dedupedParts = Array.from(new Set(parts));
  const base = dedupedParts.join('-') || 'resume';
  const withResumeSuffix = base.includes('resume') ? base : `${base}-resume`;
  return `${withResumeSuffix.slice(0, 96).replace(/-+$/g, '')}.${extension}`;
}

function slugify(value: string | undefined): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}