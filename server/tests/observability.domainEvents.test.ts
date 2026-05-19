import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createApp, RenderServerOptions } from '../src/app';
import { defaultResume } from '../../src/features/resume-generator/data/defaultResume';
import { DomainEvent, ObservabilitySink } from '../src/observability/types';

const paragraph = `I am Jordan Lee, a frontend engineer. I worked at TechCorp from 2022 until now, built a design system, mentored juniors, and before that I was at StartupXYZ doing React and TypeScript. I studied CS at Berkeley. I use React, TypeScript, Tailwind, and Figma. jordan@example.com`;
const jobDescription = 'Title: Frontend Platform Engineer. We need React, TypeScript, accessibility, design systems, Playwright testing, and Kubernetes experience for a platform team.';

describe('observability domain events', () => {
  let server: Server | undefined;
  let baseUrl = '';
  let domainEvents: DomainEvent[] = [];

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => (error ? reject(error) : resolve()));
      });
    }

    server = undefined;
    baseUrl = '';
    domainEvents = [];
  });

  it('records intake text requested and completed events', async () => {
    await startServer();

    const response = await postText({ text: paragraph });

    expect(response.status).toBe(200);
    expect(domainEvents.map(event => event.eventName)).toEqual(['intake_text_requested', 'intake_text_completed']);
    expect(domainEvents[0]?.payload).toEqual({ textLengthBucket: '100-499' });
    expect(domainEvents[1]?.payload).toMatchObject({
      usedModel: false,
      warningCodes: expect.arrayContaining(['MODEL_GATEWAY_NOT_CONFIGURED']),
    });
  });

  it('records PDF packet-block and OCR completion events', async () => {
    const packetPdf = await createPacketPdfBuffer();
    await startServer();

    const packetResponse = await postPdf({ buffer: packetPdf });

    expect(packetResponse.status).toBe(200);
    expect(domainEvents.map(event => event.eventName)).toEqual(['intake_pdf_uploaded', 'intake_pdf_packet_blocked']);
    expect(domainEvents[0]?.payload).toMatchObject({
      pageCount: 2,
      selectedPageCount: 2,
    });
    expect(domainEvents[1]?.payload).toMatchObject({
      pageCount: 2,
      signalCodes: expect.any(Array),
    });

    domainEvents = [];

    await stopServer();
    const blankPdf = await createBlankPdfBuffer();
    await startServer({
      pdfOcrConfig: {
        enabled: true,
        recognizePageBuffers: async () => ({
          text: paragraph,
          confidence: 92,
        }),
      },
    });

    const ocrResponse = await postPdf({ buffer: blankPdf });

    expect(ocrResponse.status).toBe(200);
    expect(domainEvents.map(event => event.eventName)).toEqual(['intake_pdf_uploaded', 'intake_pdf_completed']);
    expect(domainEvents[1]?.payload).toMatchObject({
      usedOcr: true,
      usedModel: false,
      warningCodes: expect.arrayContaining(['PDF_USED_OCR', 'MODEL_GATEWAY_NOT_CONFIGURED']),
    });
  });

  it('records tailoring completion and validation failure events', async () => {
    await startServer();

    const successResponse = await postTailoring({
      resume: defaultResume,
      jobDescription,
    });

    expect(successResponse.status).toBe(200);
    expect(domainEvents.map(event => event.eventName)).toEqual(['tailoring_requested', 'tailoring_completed']);
    expect(domainEvents[0]?.payload).toEqual({ jobDescriptionLengthBucket: '100-499' });
    expect(domainEvents[1]?.payload).toMatchObject({
      usedModel: false,
      changeCount: expect.any(Number),
      gapCount: expect.any(Number),
      warningCodes: expect.arrayContaining(['TAILORING_MODEL_GATEWAY_NOT_CONFIGURED']),
    });

    domainEvents = [];

    const failureResponse = await postTailoring({
      resume: defaultResume,
      jobDescription: 'too short',
    });

    expect(failureResponse.status).toBe(400);
    expect(domainEvents.map(event => event.eventName)).toEqual(['validation_failed']);
    expect(domainEvents[0]?.payload).toEqual({ errorCode: 'TAILORING_NO_JOB_DESCRIPTION' });
  });

  it('records quota exceeded events for repeated intake attempts', async () => {
    await startServer({ intakeAttemptLimit: 1 });

    const firstResponse = await postText({ text: paragraph });
    expect(firstResponse.status).toBe(200);

    domainEvents = [];

    const secondResponse = await postText({ text: paragraph });

    expect(secondResponse.status).toBe(429);
    expect(domainEvents.map(event => event.eventName)).toEqual(['intake_text_requested', 'quota_exceeded']);
  });

  async function startServer(options: RenderServerOptions = {}) {
    const sink: ObservabilitySink = {
      recordRequest: () => undefined,
      recordEvent: event => {
        domainEvents.push(event);
      },
    };

    server = createServer(createApp({
      ...options,
      observabilityConfig: {
        enabled: true,
        sink: 'noop',
        hmacSecret: 'test-observability-secret',
        trustProxy: false,
        debug: false,
      },
      observabilitySink: sink,
    }));

    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function stopServer() {
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server?.close(error => (error ? reject(error) : resolve()));
    });

    server = undefined;
    baseUrl = '';
  }

  async function postText(payload: unknown) {
    return fetch(`${baseUrl}/api/intake/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async function postTailoring(payload: unknown) {
    return fetch(`${baseUrl}/api/tailor/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async function postPdf(options: { buffer?: Buffer; pageStart?: number; pageEnd?: number } = {}) {
    const formData = new FormData();
    formData.append('file', new Blob([options.buffer || Buffer.from('')], { type: 'application/pdf' }), 'resume.pdf');

    if (typeof options.pageStart === 'number') {
      formData.append('pageStart', `${options.pageStart}`);
    }

    if (typeof options.pageEnd === 'number') {
      formData.append('pageEnd', `${options.pageEnd}`);
    }

    return fetch(`${baseUrl}/api/intake/pdf`, {
      method: 'POST',
      body: formData,
    });
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