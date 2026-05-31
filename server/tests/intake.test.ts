import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createApp, RenderServerOptions } from '../src/app';
import { analyzePdfDocument, buildPdfAnalysisWarnings } from '../src/intake/pdfAnalysis';
import { ResolvedPdfOcrConfig } from '../src/intake/pdfOcr';

const paragraph = `I am Jordan Lee, a frontend engineer. I worked at TechCorp from 2022 until now, built a design system, mentored juniors, and before that I was at StartupXYZ doing React and TypeScript. I studied CS at Berkeley. I use React, TypeScript, Tailwind, and Figma. jordan@example.com`;
const scannedPdfFixture = readFileSync(new URL('./fixtures/scanned-resume.pdf', import.meta.url));

describe('resume intake API', () => {
  let server: Server | undefined;
  let baseUrl = '';

  afterEach(async () => {
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server?.close(error => (error ? reject(error) : resolve()));
    });
    server = undefined;
    baseUrl = '';
  });

  it('reports usage', async () => {
    await startServer({ intakeAttemptLimit: 3 });

    const response = await fetch(`${baseUrl}/api/intake/usage`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ remainingAttempts: 3, limit: 3, resetAt: null });
  });

  it('rejects invalid text payloads with structured errors', async () => {
    await startServer();

    const response = await postText({ text: 'too short' });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty PDF upload', async () => {
    await startServer();

    const response = await postPdf();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-PDF uploads', async () => {
    await startServer();

    const response = await postPdf({
      buffer: Buffer.from('plain text resume'),
      fileName: 'resume.txt',
      mimeType: 'text/plain',
    });
    const payload = await response.json();

    expect(response.status).toBe(415);
    expect(payload.error.code).toBe('PDF_UNSUPPORTED_TYPE');
  });

  it('rejects oversized PDF uploads', async () => {
    const pdfBuffer = await createTextPdfBuffer(paragraph);
    await startServer({ intakeMaxPdfBytes: 256 });

    const response = await postPdf({ buffer: pdfBuffer });
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe('PDF_TOO_LARGE');
  });

  it('parses a valid text-based PDF and routes extracted text through the shared intake path', async () => {
    const pdfBuffer = await createTextPdfBuffer(paragraph);
    let capturedModelInput = '';

    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body?.toString() || '{}') as { messages: Array<{ content: string }> };
      capturedModelInput = body.messages[1]?.content || '';
      return modelResponse(JSON.stringify(modelDraft()));
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postPdf({ buffer: pdfBuffer });
    const payload = await response.json();
    const draftPayload = expectDraftPayload(payload);

    expect(response.status).toBe(200);
    expect(payload.analysis.classification).toBe('single_resume');
    expect(draftPayload.source.kind).toBe('pdf');
    expect(draftPayload.source.extractedText).toContain('Jordan Lee');
    expect(capturedModelInput).toContain('Jordan Lee');
    expect(capturedModelInput).toContain('TechCorp');
  });

  it('consumes one attempt for PDF import', async () => {
    const pdfBuffer = await createTextPdfBuffer(paragraph);
    await startServer({ intakeAttemptLimit: 1 });

    const firstResponse = await postPdf({ buffer: pdfBuffer });
    expect(firstResponse.status).toBe(200);
    expectDraftPayload(await firstResponse.json());

    const usageResponse = await fetch(`${baseUrl}/api/intake/usage`);
    expect(await usageResponse.json()).toEqual({ remainingAttempts: 0, limit: 1, resetAt: null });
  });

  it('returns a clear error when a PDF has no extractable text', async () => {
    const blankPdf = await createBlankPdfBuffer();
    await startServer();

    const response = await postPdf({ buffer: blankPdf });
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('PDF_TEXT_NOT_FOUND');
  });

  it('uses OCR fallback for scanned PDFs when OCR is enabled', async () => {
    const blankPdf = await createBlankPdfBuffer();
    let capturedModelInput = '';

    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body?.toString() || '{}') as { messages: Array<{ content: string }> };
      capturedModelInput = body.messages[1]?.content || '';
      return modelResponse(JSON.stringify(modelDraft()));
    };

    await startServer({
      pdfOcrConfig: {
        enabled: true,
        recognizePageBuffers: async (_pages: Buffer[], _options: ResolvedPdfOcrConfig) => ({
          text: paragraph,
          confidence: 92,
        }),
      },
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postPdf({ buffer: blankPdf });
    const payload = await response.json();
    const draftPayload = expectDraftPayload(payload);

    expect(response.status).toBe(200);
    expect(draftPayload.source.kind).toBe('pdf');
    expect(draftPayload.source.extractedText).toContain('Jordan Lee');
    expect(capturedModelInput).toContain('Jordan Lee');
    expect(draftPayload.warnings.some((warning: { code: string }) => warning.code === 'PDF_USED_OCR')).toBe(true);
  });

  it('deduplicates repeated missing warnings after OCR warnings are merged', async () => {
    const blankPdf = await createBlankPdfBuffer();
    const fetchImpl: typeof fetch = async () => modelResponse(JSON.stringify(modelDraft({
      warnings: [
        { code: 'MISSING_LOCATION', message: 'Location missing.', fieldPath: 'experience.0.location' },
        { code: 'MISSING_PHONE', message: 'Phone number missing.', fieldPath: 'experience.0.phone' },
      ],
    })));

    await startServer({
      pdfOcrConfig: {
        enabled: true,
        recognizePageBuffers: async (_pages: Buffer[], _options: ResolvedPdfOcrConfig) => ({
          text: paragraph,
          confidence: 92,
        }),
      },
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postPdf({ buffer: blankPdf });
    const payload = await response.json();
    const draftPayload = expectDraftPayload(payload);
    const locationWarnings = draftPayload.warnings.filter((warning: { code: string }) => warning.code === 'MISSING_LOCATION');
    const phoneWarnings = draftPayload.warnings.filter((warning: { code: string }) => warning.code === 'MISSING_PHONE');

    expect(response.status).toBe(200);
    expect(locationWarnings).toHaveLength(1);
    expect(phoneWarnings).toHaveLength(1);
    expect(draftPayload.warnings.some((warning: { code: string }) => warning.code === 'PDF_USED_OCR')).toBe(true);
  });

  it('adds a low OCR confidence warning when OCR quality is weak', async () => {
    const blankPdf = await createBlankPdfBuffer();

    await startServer({
      pdfOcrConfig: {
        enabled: true,
        lowConfidenceThreshold: 80,
        recognizePageBuffers: async (_pages: Buffer[], _options: ResolvedPdfOcrConfig) => ({
          text: paragraph,
          confidence: 52,
        }),
      },
    });

    const response = await postPdf({ buffer: blankPdf });
    const payload = await response.json();
    const draftPayload = expectDraftPayload(payload);
    const lowConfidenceWarning = draftPayload.warnings.find((warning: { code: string }) => warning.code === 'PDF_OCR_LOW_CONFIDENCE');

    expect(response.status).toBe(200);
    expect(lowConfidenceWarning?.message).toContain('52%');
    expect(draftPayload.warnings.some((warning: { code: string }) => warning.code === 'PDF_USED_OCR')).toBe(true);
  });

  it('extracts text from the scanned OCR fixture with the real OCR path', async () => {
    await startServer({
      pdfOcrConfig: {
        enabled: true,
        lowConfidenceThreshold: 1,
      },
    });

    const response = await postPdf({ buffer: scannedPdfFixture });
    const payload = await response.json();
    const draftPayload = expectDraftPayload(payload);

    expect(response.status).toBe(200);
    expect(draftPayload.source.kind).toBe('pdf');
    expect(draftPayload.source.extractedText.toLowerCase()).toContain('jordan lee');
    expect(draftPayload.source.extractedText.toLowerCase()).toContain('techcorp');
    expect(draftPayload.warnings.some((warning: { code: string }) => warning.code === 'PDF_USED_OCR')).toBe(true);
  }, 20_000);

  it('classifies single resumes, packets, and uncertain PDFs before model intake', () => {
    const singleResumeAnalysis = analyzePdfDocument({
      pageCount: 1,
      extractedText: 'Jordan Lee\nFrontend Engineer\njordan@example.com\nExperience\nTechCorp\nEducation\nUniversity of California\nSkills\nReact\nTypeScript',
    });
    const packetAnalysis = analyzePdfDocument({
      pageCount: 8,
      extractedText: [
        'Resume Packet',
        'Career Services',
        'Jordan Lee',
        'jordan@example.com',
        'Experience',
        'Education',
        'Taylor Smith',
        'taylor@example.com',
        'Experience',
        'Education',
      ].join('\n'),
    });
    const uncertainAnalysis = analyzePdfDocument({
      pageCount: 4,
      extractedText: [
        'Jordan Lee',
        'jordan@example.com',
        'Experience',
        'Education',
        'Objective',
        'References',
        'Experience',
        'Education',
      ].join('\n'),
    });
    const multiPageSingleCandidateAnalysis = analyzePdfDocument({
      pageCount: 3,
      extractedText: [
        'Brutus Buckeye',
        'brutus@osu.edu',
        'buckeye.personal@gmail.com',
        '+1 614 555 0101',
        '+1 614 555 0102',
        'Data Analytics',
        'Projects',
        'Experience',
        'Education',
      ].join('\n'),
    });

    expect(singleResumeAnalysis.classification).toBe('single_resume');
    expect(packetAnalysis.classification).toBe('likely_packet');
    expect(buildPdfAnalysisWarnings(packetAnalysis).some(warning => warning.code === 'PDF_LIKELY_PACKET')).toBe(true);
    expect(uncertainAnalysis.classification).toBe('uncertain');
    expect(buildPdfAnalysisWarnings(uncertainAnalysis).some(warning => warning.code === 'PDF_REVIEW_REQUIRED')).toBe(true);
    expect(multiPageSingleCandidateAnalysis.classification).not.toBe('likely_packet');
  });

  it('returns selection-required for likely packet PDFs without consuming an attempt or calling the model', async () => {
    const packetPdf = await createPacketPdfBuffer();
    let modelCallCount = 0;

    const fetchImpl: typeof fetch = async () => {
      modelCallCount += 1;
      return modelResponse(JSON.stringify(modelDraft()));
    };

    await startServer({
      intakeAttemptLimit: 1,
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postPdf({ buffer: packetPdf });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.kind).toBe('selection_required');
    expect(payload.requiresPageSelection).toBe(true);
    expect(payload.analysis.classification).toBe('likely_packet');
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'PDF_LIKELY_PACKET')).toBe(true);
    expect(modelCallCount).toBe(0);

    const usageResponse = await fetch(`${baseUrl}/api/intake/usage`);
    expect(await usageResponse.json()).toEqual({ remainingAttempts: 1, limit: 1, resetAt: null });
  });

  it('rejects invalid PDF page ranges', async () => {
    const packetPdf = await createPacketPdfBuffer();
    await startServer();

    const response = await postPdf({ buffer: packetPdf, pageStart: 2, pageEnd: 99 });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
  });

  it('uses only the selected page range when generating a draft from a packet PDF', async () => {
    const packetPdf = await createPacketPdfBuffer();
    let capturedModelInput = '';

    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body?.toString() || '{}') as { messages: Array<{ content: string }> };
      capturedModelInput = body.messages[1]?.content || '';
      return modelResponse(JSON.stringify(modelDraft()));
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postPdf({ buffer: packetPdf, pageStart: 1, pageEnd: 1 });
    const payload = await response.json();
    const draftPayload = expectDraftPayload(payload);

    expect(response.status).toBe(200);
    expect(payload.analysis.analyzedPageRange).toEqual({ start: 1, end: 1 });
    expect(payload.selectedPageRange).toEqual({ start: 1, end: 1 });
    expect(draftPayload.source.extractedText).toContain('Jordan Lee');
    expect(draftPayload.source.extractedText).not.toContain('Taylor Smith');
    expect(capturedModelInput).toContain('Jordan Lee');
    expect(capturedModelInput).not.toContain('Taylor Smith');
  });

  it('returns a structured OCR error when OCR fails on a scanned PDF', async () => {
    const blankPdf = await createBlankPdfBuffer();

    await startServer({
      pdfOcrConfig: {
        enabled: true,
        recognizePageBuffers: async () => {
          throw new Error('ocr unavailable');
        },
      },
    });

    const response = await postPdf({ buffer: blankPdf });
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('PDF_OCR_FAILED');
  });

  it('returns a clear error when a PDF cannot be parsed', async () => {
    await startServer();

    const response = await postPdf({
      buffer: Buffer.from('%PDF broken content that will not parse'),
      fileName: 'broken.pdf',
      mimeType: 'application/pdf',
    });
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('PDF_PARSE_FAILED');
  });

  it('generates a structured paragraph draft', async () => {
    await startServer({ intakeAttemptLimit: 3 });

    const response = await postText({ text: paragraph });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resume.personal.fullName).toBe('Jordan Lee');
    expect(payload.resume.personal.email).toBe('jordan@example.com');
    expect(payload.resume.experience.map((entry: { company: string }) => entry.company)).toContain('TechCorp');
    expect(payload.resume.experience.map((entry: { company: string }) => entry.company)).toContain('StartupXYZ');
    expect(payload.resume.education[0].school).toBe('Berkeley');
    expect(payload.resume.skills[0].items).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Tailwind', 'Figma']));
    expect(payload.confidence.overall).toBeGreaterThan(0.4);
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_NOT_CONFIGURED')).toBe(true);
  });

  it('uses a configured OpenAI-compatible model gateway when available', async () => {
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              resume: {
                id: 'ai-draft',
                title: 'Frontend Engineer Resume',
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
                  phone: '',
                  location: '',
                },
                summary: 'Frontend engineer with React and TypeScript experience.',
                experience: [{
                  id: 'exp-1',
                  company: 'TechCorp',
                  role: 'Frontend Engineer',
                  startDate: '2022',
                  endDate: '',
                  current: true,
                  bullets: ['Built a design system.'],
                }],
                education: [],
                skills: [{
                  id: 'skill-1',
                  category: 'Core',
                  items: ['React', 'TypeScript'],
                }],
                projects: [],
              },
              confidence: {
                overall: 0.9,
                sections: {
                  personal: 0.9,
                  summary: 0.9,
                  experience: 0.9,
                  education: 0.2,
                  skills: 0.9,
                  projects: 0.2,
                },
              },
              warnings: [],
              source: { kind: 'paragraph' },
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const inspectingFetch: typeof fetch = async (input, init) => {
      capturedUrl = input.toString();
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(init?.body?.toString() || '{}') as Record<string, unknown>;
      return fetchImpl(input, init);
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl: inspectingFetch,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resume.id).toBe('ai-draft');
    expect(payload.resume.personal.fullName).toBe('Jordan Lee');
    expect(payload.warnings.map((warning: { code: string }) => warning.code)).toEqual(
      expect.arrayContaining(['MISSING_PHONE', 'MISSING_LOCATION', 'MISSING_EDUCATION']),
    );
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_OUTPUT_REPAIRED')).toBe(false);
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(false);
    expect(payload.source.extractedText).toContain('Jordan Lee');
    expect(capturedUrl).toBe('https://gateway.example.com/v1/chat/completions');
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer test-key');
    expect(capturedBody?.model).toBe('MiniMax-M2.7');
    expect(capturedBody?.response_format).toEqual({ type: 'json_object' });
  });

  it('repairs malformed model JSON once before returning the model draft', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      callCount += 1;
      const body = JSON.parse(init?.body?.toString() || '{}') as { messages: Array<{ content: string }> };

      if (callCount === 1) {
        return modelResponse('{not-json');
      }

      expect(body.messages[0].content).toContain('repair JSON');
      expect(body.messages[0].content).toContain('{not-json');
      return modelResponse(JSON.stringify(modelDraft({
        resume: {
          id: 'repaired-draft',
          title: 'Frontend Engineer Resume',
          templateId: 'clean-professional',
          design: defaultDesign(),
          personal: {
            fullName: 'Jordan Lee',
            headline: 'Frontend Engineer',
            email: 'jordan@example.com',
            phone: '',
            location: '',
          },
          summary: 'Frontend engineer focused on React and TypeScript.',
          experience: [],
          education: [],
          skills: [{ id: 'skill-1', category: 'Core', items: ['React', 'TypeScript'] }],
          projects: [],
        },
      })));
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();
    const warningCodes = payload.warnings.map((warning: { code: string }) => warning.code);

    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(payload.resume.id).toBe('repaired-draft');
    expect(warningCodes.filter((code: string) => code === 'MODEL_OUTPUT_REPAIRED')).toHaveLength(1);
    expect(warningCodes).not.toContain('MODEL_GATEWAY_FAILED');
  });

  it('repairs schema-invalid model JSON once before returning the model draft', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount += 1;

      if (callCount === 1) {
        return modelResponse(JSON.stringify({ resume: { experience: [{}] } }));
      }

      return modelResponse(JSON.stringify(modelDraft({
        resume: {
          id: 'schema-repaired-draft',
          title: 'Frontend Engineer Resume',
          templateId: 'clean-professional',
          design: defaultDesign(),
          personal: {
            fullName: 'Jordan Lee',
            headline: 'Frontend Engineer',
            email: 'jordan@example.com',
            phone: '',
            location: '',
          },
          summary: 'Frontend engineer focused on React and TypeScript.',
          experience: [],
          education: [],
          skills: [{ id: 'skill-1', category: 'Core', items: ['React', 'TypeScript'] }],
          projects: [],
        },
      })));
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(payload.resume.id).toBe('schema-repaired-draft');
    expect(payload.warnings.filter((warning: { code: string }) => warning.code === 'MODEL_OUTPUT_REPAIRED')).toHaveLength(1);
  });

  it('normalizes and deduplicates model warning codes', async () => {
    const fetchImpl: typeof fetch = async () => modelResponse(JSON.stringify(modelDraft({
      warnings: [
        'missing contact info',
        { code: 'MISSING_FIELD', message: 'No phone number found.', fieldPath: 'personal.phone' },
        { code: 'MISSING_FIELD', message: 'No phone number found again.', fieldPath: 'personal.phone' },
        { code: 'UNCLEAR_DATES', message: 'Dates are uncertain.', fieldPath: 'experience.0' },
      ],
    })));

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();
    const phoneWarnings = payload.warnings.filter((warning: { code: string }) => warning.code === 'MISSING_PHONE');

    expect(response.status).toBe(200);
    expect(payload.warnings.map((warning: { code: string }) => warning.code)).toEqual(
      expect.arrayContaining(['MISSING_PHONE', 'UNCERTAIN_DATES']),
    );
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MISSING_EMAIL')).toBe(false);
    expect(phoneWarnings).toHaveLength(1);
    expect(payload.warnings.some((warning: { code: string }) => warning.code.startsWith('MODEL_WARNING'))).toBe(false);
  });

  it('removes model missing-field warnings when the extracted field is present', async () => {
    const fetchImpl: typeof fetch = async () => modelResponse(JSON.stringify(modelDraft({
      resume: {
        ...modelDraft().resume,
        personal: {
          ...modelDraft().resume.personal,
          location: 'San Francisco, CA',
        },
        summary: 'Frontend engineer with design systems and product delivery experience.',
      },
      warnings: [
        { code: 'MISSING_SUMMARY', message: 'Summary missing.' },
        { code: 'MISSING_LOCATION', message: 'Location missing.' },
      ],
    })));

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();
    const warningCodes = payload.warnings.map((warning: { code: string }) => warning.code);

    expect(response.status).toBe(200);
    expect(warningCodes).not.toContain('MISSING_SUMMARY');
    expect(warningCodes).not.toContain('MISSING_LOCATION');
  });

  it('accepts sparse Case C model output without hallucinated entries', async () => {
    const fetchImpl: typeof fetch = async () => modelResponse(JSON.stringify(modelDraft({
      resume: {
        id: 'case-c-draft',
        title: 'Frontend Engineer Resume',
        templateId: 'clean-professional',
        design: defaultDesign(),
        personal: {
          fullName: 'Imported Candidate',
          headline: 'Frontend Engineer',
          email: '',
          phone: '',
          location: '',
        },
        summary: 'Frontend engineer candidate focused on React, TypeScript, web apps, accessibility, and design systems.',
        experience: [],
        education: [],
        skills: [{ id: 'skill-1', category: 'Core', items: ['React', 'TypeScript', 'Accessibility', 'Design Systems'] }],
        projects: [],
      },
    })));

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({
      text: 'I build React and TypeScript web apps and am applying for frontend roles. I care about accessibility and design systems.',
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resume.personal.headline).toBe('Frontend Engineer');
    expect(payload.resume.experience).toEqual([]);
    expect(payload.resume.education).toEqual([]);
    expect(payload.resume.skills[0].items).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Accessibility', 'Design Systems']));
    expect(payload.warnings.map((warning: { code: string }) => warning.code)).toEqual(
      expect.arrayContaining(['MISSING_NAME', 'MISSING_EMAIL', 'MISSING_PHONE', 'MISSING_LOCATION', 'MISSING_EXPERIENCE', 'MISSING_EDUCATION']),
    );
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(false);
  });

  it('accepts a structured Chinese draft from the model gateway', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              resume: {
                id: 'ai-cn-draft',
                title: '前端工程师简历',
                templateId: 'clean-professional',
                design: {
                  typography: 'classic',
                  density: 'comfortable',
                  pageSize: 'letter',
                  accentColor: '#2563eb',
                },
                personal: {
                  fullName: '王晨',
                  headline: '前端工程师',
                  email: '',
                  phone: '',
                  location: '',
                },
                summary: '前端工程师，具备设计系统、React 组件库和 TypeScript 开发经验。',
                experience: [{
                  id: 'exp-1',
                  company: 'TechCorp',
                  role: '前端工程师',
                  startDate: '2022',
                  endDate: '',
                  current: true,
                  bullets: ['负责设计系统和 React 组件库。'],
                }],
                education: [{
                  id: 'edu-1',
                  school: '伯克利',
                  degree: '本科',
                  field: '计算机科学',
                }],
                skills: [{
                  id: 'skill-1',
                  category: '技能',
                  items: ['React', 'TypeScript', 'Tailwind CSS', 'Figma'],
                }],
                projects: [],
              },
              confidence: {
                overall: 0.86,
                sections: {
                  personal: 0.9,
                  summary: 0.85,
                  experience: 0.85,
                  education: 0.8,
                  skills: 0.9,
                  projects: 0.2,
                },
              },
              warnings: [{ code: 'MISSING_CONTACT', message: '未检测到联系方式。', fieldPath: 'personal.email' }],
              source: { kind: 'paragraph' },
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({
      text: '我叫王晨，是一名前端工程师。2022 年开始在 TechCorp 工作，负责设计系统和 React 组件库。',
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resume.personal.fullName).toBe('王晨');
    expect(payload.resume.experience[0].company).toBe('TechCorp');
    expect(payload.resume.education[0].field).toBe('计算机科学');
    expect(payload.resume.skills[0].items).toEqual(expect.arrayContaining(['React', 'TypeScript']));
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_NOT_CONFIGURED')).toBe(false);
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(false);
  });

  it('falls back to the local parser if the model gateway fails', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 500 });

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resume.personal.fullName).toBe('Jordan Lee');
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(true);
  });

  it('falls back if the model gateway returns malformed JSON content', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{not-json' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(payload.resume.personal.fullName).toBe('Jordan Lee');
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(true);
  });

  it('falls back if the model gateway returns schema-invalid JSON', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ resume: { experience: [{}] } }) } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postText({ text: paragraph });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(payload.resume.personal.fullName).toBe('Jordan Lee');
    expect(payload.warnings.some((warning: { code: string }) => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(true);
  });

  it('does not hallucinate entries in sparse Case C local fallback', async () => {
    await startServer();

    const response = await postText({
      text: 'I build React and TypeScript web apps and am applying for frontend roles. I care about accessibility and design systems.',
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resume.personal.headline).toBe('Frontend Engineer');
    expect(payload.resume.experience).toEqual([]);
    expect(payload.resume.education).toEqual([]);
    expect(payload.resume.skills[0].items).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Design Systems', 'Accessibility']));
    expect(payload.warnings.map((warning: { code: string }) => warning.code)).toEqual(
      expect.arrayContaining(['MODEL_GATEWAY_NOT_CONFIGURED', 'MISSING_EXPERIENCE', 'MISSING_EDUCATION']),
    );
  });

  it('consumes attempts and enforces the quota', async () => {
    await startServer({ intakeAttemptLimit: 1 });

    const firstResponse = await postText({ text: paragraph });
    expect(firstResponse.status).toBe(200);

    const usageResponse = await fetch(`${baseUrl}/api/intake/usage`);
    expect(await usageResponse.json()).toEqual({ remainingAttempts: 0, limit: 1, resetAt: null });

    const secondResponse = await postText({ text: paragraph });
    const secondPayload = await secondResponse.json();
    expect(secondResponse.status).toBe(429);
    expect(secondPayload.error.code).toBe('QUOTA_EXCEEDED');
  });

  async function startServer(options: RenderServerOptions = {}) {
    server = createServer(createApp(options));
    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  function postText(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/intake/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function postPdf(options: { buffer?: Buffer; fileName?: string; mimeType?: string; pageStart?: number; pageEnd?: number } = {}): Promise<Response> {
    const formData = new FormData();
    if (options.buffer) {
      const file = new File([options.buffer], options.fileName || 'resume.pdf', {
        type: options.mimeType || 'application/pdf',
      });
      formData.set('file', file);
    }

    if (typeof options.pageStart === 'number') {
      formData.set('pageStart', String(options.pageStart));
    }

    if (typeof options.pageEnd === 'number') {
      formData.set('pageEnd', String(options.pageEnd));
    }

    return fetch(`${baseUrl}/api/intake/pdf`, {
      method: 'POST',
      body: formData,
    });
  }

  function expectDraftPayload(payload: any) {
    expect(payload.kind).toBe('draft');
    expect(payload.requiresPageSelection).toBe(false);
    return payload.draft;
  }

  function modelResponse(content: string): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function defaultDesign() {
    return {
      typography: 'classic',
      density: 'comfortable',
      pageSize: 'letter',
      accentColor: '#2563eb',
    };
  }

  function modelDraft(overrides: Record<string, unknown> = {}) {
    return {
      resume: {
        id: 'ai-draft',
        title: 'Frontend Engineer Resume',
        templateId: 'clean-professional',
        design: defaultDesign(),
        personal: {
          fullName: 'Jordan Lee',
          headline: 'Frontend Engineer',
          email: 'jordan@example.com',
          phone: '',
          location: '',
        },
        summary: 'Frontend engineer with React and TypeScript experience.',
        experience: [{
          id: 'exp-1',
          company: 'TechCorp',
          role: 'Frontend Engineer',
          startDate: '2022',
          endDate: '',
          current: true,
          bullets: ['Built a design system.'],
        }],
        education: [],
        skills: [{ id: 'skill-1', category: 'Core', items: ['React', 'TypeScript'] }],
        projects: [],
      },
      confidence: {
        overall: 0.9,
        sections: {
          personal: 0.9,
          summary: 0.9,
          experience: 0.9,
          education: 0.2,
          skills: 0.9,
          projects: 0.2,
        },
      },
      warnings: [],
      source: { kind: 'paragraph' },
      ...overrides,
    };
  }

  async function createTextPdfBuffer(text: string): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const lines = text.split('. ').map(line => line.trim()).filter(Boolean);
    let y = 720;

    for (const line of lines) {
      page.drawText(line, {
        x: 72,
        y,
        size: 12,
        font,
        color: rgb(0.15, 0.15, 0.18),
        maxWidth: 468,
        lineHeight: 14,
      });
      y -= 18;
    }

    return Buffer.from(await pdfDoc.save());
  }

  async function createBlankPdfBuffer(): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);
    return Buffer.from(await pdfDoc.save());
  }

  async function createPacketPdfBuffer(): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const firstPage = pdfDoc.addPage([612, 792]);
    const secondPage = pdfDoc.addPage([612, 792]);

    drawLines(firstPage, font, [
      'Jordan Lee',
      'Frontend Engineer',
      'jordan@example.com',
      '415-555-0101',
      'Experience',
      'TechCorp',
      'Education',
      'University of California',
    ]);

    drawLines(secondPage, font, [
      'Resume Samples',
      'Taylor Smith',
      'Product Designer',
      'taylor@example.com',
      '212-555-0199',
      'Experience',
      'StudioCo',
      'Education',
      'Parsons School of Design',
    ]);

    return Buffer.from(await pdfDoc.save());
  }

  function drawLines(page: PDFDocument['context']['page'] extends never ? never : any, font: any, lines: string[]) {
    let y = 720;
    for (const line of lines) {
      page.drawText(line, {
        x: 72,
        y,
        size: 12,
        font,
        color: rgb(0.15, 0.15, 0.18),
        maxWidth: 468,
        lineHeight: 14,
      });
      y -= 18;
    }
  }
});
