// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { applyIntakeDraftToResume } from '@/features/resume-generator/lib/pdfIntakeFlow';
import { StartIntakeSection } from '@/features/resume-generator/components/ResumeEditorPanel';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('PDF intake flow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');

    const resume = getDefaultResume('en');
    useResumeGeneratorStore.setState({
      ...useResumeGeneratorStore.getState(),
      resume: JSON.parse(JSON.stringify(resume)),
      typstSource: renderResumeToTypst(resume, resume.templateId, 'en'),
      versions: [],
      renderStatus: 'idle',
      renderError: null,
      svgHtml: null,
    });

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows page selection UI for packet-like PDFs and only enables apply after a narrowed draft exists', async () => {
    const pdfBodies: Array<{ pageStart: FormDataEntryValue | null; pageEnd: FormDataEntryValue | null }> = [];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/usage')) {
        return jsonResponse({ remainingAttempts: 3, limit: 3, resetAt: null });
      }

      if (url.endsWith('/pdf')) {
        const formData = init?.body as FormData;
        const pageStart = formData.get('pageStart');
        const pageEnd = formData.get('pageEnd');
        pdfBodies.push({ pageStart, pageEnd });

        if (!pageStart && !pageEnd) {
          return jsonResponse({
            kind: 'selection_required',
            requiresPageSelection: true,
            analysis: {
              pageCount: 10,
              extractedTextChars: 11000,
              classification: 'likely_packet',
              signals: [
                { code: 'MULTIPLE_EMAILS', message: 'Detected 2 distinct email addresses in one PDF.' },
                { code: 'LONG_DOCUMENT', message: 'The PDF is 10 pages long, which is unusual for a single resume upload.' },
              ],
            },
            warnings: [
              {
                code: 'PDF_LIKELY_PACKET',
                message: 'This PDF looks like multiple resumes or a resume packet. Choose a page or page range before generating a draft.',
              },
              {
                code: 'PDF_MULTIPLE_CANDIDATES',
                message: 'This PDF appears to contain names or contact details for more than one person.',
              },
            ],
          });
        }

        return jsonResponse({
          kind: 'draft',
          requiresPageSelection: false,
          analysis: {
            pageCount: 10,
            extractedTextChars: 2100,
            classification: 'single_resume',
            signals: [],
            analyzedPageRange: { start: 1, end: 1 },
          },
          selectedPageRange: { start: 1, end: 1 },
          draft: buildPdfDraft({
            warnings: [],
          }),
        });
      }

      return jsonResponse({});
    });

    await act(async () => {
      root.render(<StartIntakeSection onGoToContent={vi.fn()} />);
    });
    await flushUi();

    const uploadPdfButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Upload PDF'));
    expect(uploadPdfButton).toBeTruthy();

    await act(async () => {
      uploadPdfButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['packet'], 'packet.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain('Choose which pages contain your resume');
    expect(container.textContent).toContain('This PDF looks like it contains more than one resume. To avoid mixing people together, choose the page or pages for your resume, then continue.');
    expect(container.textContent).toContain('More than one resume detected');
    expect(container.textContent).toContain('10 pages in file');
    expect(container.textContent).toContain('Detected 2 distinct email addresses in one PDF.');
    expect(container.textContent).toContain('Choose the pages that contain your resume before import can continue.');
    expect(container.textContent).not.toContain('Apply draft');

    const pageInputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(pageInputs).toHaveLength(2);

    await act(async () => {
      pageInputs[0].value = '1';
      pageInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      pageInputs[1].value = '1';
      pageInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Choose pages to import'));
    expect(generateButton).toBeTruthy();

    await act(async () => {
      generateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    expect(pdfBodies).toHaveLength(2);
    expect(pdfBodies[0]).toEqual({ pageStart: null, pageEnd: null });
    expect(pdfBodies[1]).toEqual({ pageStart: '1', pageEnd: '1' });
    expect(container.textContent).toContain('Apply draft');
    expect(container.textContent).toContain('Pages 1-1 of 10');
  });

  it('renders review-required warnings clearly for uncertain PDFs', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/usage')) {
        return jsonResponse({ remainingAttempts: 3, limit: 3, resetAt: null });
      }

      if (url.endsWith('/pdf')) {
        const formData = init?.body as FormData;
        expect(formData.get('pageStart')).toBeNull();
        return jsonResponse({
          kind: 'draft',
          requiresPageSelection: false,
          analysis: {
            pageCount: 4,
            extractedTextChars: 5100,
            classification: 'uncertain',
            signals: [
              { code: 'REPEATED_SECTION_HEADINGS', message: 'More than one core section heading repeats in the extracted text, which may indicate multiple resumes.' },
            ],
          },
          draft: buildPdfDraft({
            warnings: [
              {
                code: 'PDF_REVIEW_REQUIRED',
                message: 'This PDF may include extra pages or ambiguous structure. Review the generated draft carefully before applying.',
              },
            ],
          }),
        });
      }

      return jsonResponse({});
    });

    await act(async () => {
      root.render(<StartIntakeSection onGoToContent={vi.fn()} />);
    });
    await flushUi();

    const uploadPdfButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Upload PDF'));
    expect(uploadPdfButton).toBeTruthy();

    await act(async () => {
      uploadPdfButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['uncertain'], 'uncertain.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain('Review required');
    expect(container.textContent).toContain('This PDF may contain more than one resume. Review the draft carefully before applying it.');
    expect(container.textContent).toContain('Apply draft');
  });

  it('preserves the current template and design when applying an intake draft', () => {
    const currentResume = {
      ...getDefaultResume('en'),
      templateId: 'modern-compact',
      design: {
        typography: 'sans',
        density: 'compact',
        pageSize: 'a4',
        accentColor: '#0f766e',
      },
    };
    const draftResume = {
      ...getDefaultResume('en'),
      templateId: 'clean-professional',
      design: {
        typography: 'classic',
        density: 'comfortable',
        pageSize: 'letter',
        accentColor: '#2563eb',
      },
      personal: {
        ...getDefaultResume('en').personal,
        fullName: 'Jordan Lee',
      },
    };

    const appliedResume = applyIntakeDraftToResume(currentResume, draftResume);

    expect(appliedResume.templateId).toBe('modern-compact');
    expect(appliedResume.design).toEqual(currentResume.design);
    expect(appliedResume.personal.fullName).toBe('Jordan Lee');
  });
});

function buildPdfDraft(overrides: Record<string, unknown> = {}) {
  return {
    resume: {
      id: 'pdf-draft',
      title: 'Jordan Lee Resume',
      templateId: 'clean-professional',
      design: {
        typography: 'classic',
        density: 'comfortable',
        pageSize: 'letter',
        accentColor: '#2563eb',
      },
      personal: {
        fullName: 'Jordan Lee',
        headline: 'Frontend Engineer',
        email: 'jordan@example.com',
        phone: '415-555-0101',
        location: 'San Francisco, CA',
      },
      summary: 'Frontend engineer with React and TypeScript experience.',
      experience: [
        {
          id: 'exp-1',
          company: 'TechCorp',
          role: 'Frontend Engineer',
          startDate: '2022',
          endDate: '',
          current: true,
          bullets: ['Built a design system.'],
        },
      ],
      education: [
        {
          id: 'edu-1',
          school: 'University of California',
          degree: 'B.S.',
          field: 'Computer Science',
        },
      ],
      skills: [
        {
          id: 'skill-1',
          category: 'Core',
          items: ['React', 'TypeScript'],
        },
      ],
      projects: [],
    },
    confidence: {
      overall: 0.88,
      sections: {
        personal: 0.9,
        summary: 0.82,
        experience: 0.9,
        education: 0.82,
        skills: 0.9,
        projects: 0.3,
      },
    },
    warnings: [],
    source: {
      kind: 'pdf',
      extractedText: 'Jordan Lee\nFrontend Engineer\njordan@example.com',
    },
    ...overrides,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}