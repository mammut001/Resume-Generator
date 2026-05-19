import { IncomingMessage } from 'node:http';
import Busboy from 'busboy';
import { PDFParse } from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { RenderHttpError } from '../lib/errors.js';
import { PdfOcrConfig, resolvePdfOcrConfig } from './pdfOcr.js';
import { PdfDocumentPageRange, ResumeIntakeWarning } from './types.js';

const MIN_EXTRACTED_PDF_TEXT_CHARS = 20;

export type ExtractedPdfTextResult = {
  text: string;
  warnings: ResumeIntakeWarning[];
  usedOcr: boolean;
  ocrConfidence?: number;
};

export type PdfUploadRequest = {
  pdfBuffer: Buffer;
  pageStart?: number;
  pageEnd?: number;
};

export async function readPdfUpload(req: IncomingMessage, maxPdfBytes: number): Promise<Buffer> {
  const upload = await readPdfUploadRequest(req, maxPdfBytes);
  return upload.pdfBuffer;
}

export async function readPdfUploadRequest(req: IncomingMessage, maxPdfBytes: number): Promise<PdfUploadRequest> {
  const contentType = req.headers['content-type'];
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Expected multipart/form-data with one PDF file in the file field.');
  }

  return new Promise<PdfUploadRequest>((resolve, reject) => {
    let uploadBuffer: Buffer | null = null;
    let matchedFileCount = 0;
    let unexpectedFileField = false;
    let tooManyFiles = false;
    let unsupportedType = false;
    let fileTooLarge = false;
    const fieldValues: Record<string, string[]> = {};

    try {
      const busboy = Busboy({
        headers: req.headers,
        limits: {
          files: 2,
          fileSize: maxPdfBytes,
        },
      });

      busboy.on('field', (fieldName, value) => {
        if (fieldName !== 'pageStart' && fieldName !== 'pageEnd') return;
        fieldValues[fieldName] = [...(fieldValues[fieldName] || []), value];
      });

      busboy.on('file', (fieldName, file, info) => {
        const { filename, mimeType } = info;
        if (fieldName !== 'file') {
          unexpectedFileField = true;
          file.resume();
          return;
        }

        matchedFileCount += 1;
        if (matchedFileCount > 1) {
          tooManyFiles = true;
          file.resume();
          return;
        }

        if (!looksLikePdf(filename, mimeType)) {
          unsupportedType = true;
          file.resume();
          return;
        }

        const chunks: Buffer[] = [];
        file.on('limit', () => {
          fileTooLarge = true;
        });
        file.on('data', chunk => {
          if (!fileTooLarge) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        });
        file.on('end', () => {
          if (!fileTooLarge) {
            uploadBuffer = Buffer.concat(chunks);
          }
        });
      });

      busboy.on('filesLimit', () => {
        tooManyFiles = true;
      });

      busboy.on('error', () => {
        reject(new RenderHttpError(400, 'BAD_REQUEST', 'Failed to read the uploaded PDF file.'));
      });

      busboy.on('close', () => {
        if (fileTooLarge) {
          reject(new RenderHttpError(413, 'PDF_TOO_LARGE', `PDF uploads must be ${maxPdfBytes} bytes or less.`));
          return;
        }

        if (unsupportedType) {
          reject(new RenderHttpError(415, 'PDF_UNSUPPORTED_TYPE', 'Upload a PDF file (.pdf).'));
          return;
        }

        if (unexpectedFileField || tooManyFiles || matchedFileCount !== 1 || !uploadBuffer) {
          reject(new RenderHttpError(400, 'VALIDATION_ERROR', 'Upload one PDF file using the file field.'));
          return;
        }

        if (uploadBuffer.length === 0) {
          reject(new RenderHttpError(400, 'VALIDATION_ERROR', 'A PDF file is required.'));
          return;
        }

        const pageStart = parseOptionalPageField('pageStart', fieldValues.pageStart);
        const pageEnd = parseOptionalPageField('pageEnd', fieldValues.pageEnd);

        if ((pageStart === undefined) !== (pageEnd === undefined)) {
          reject(new RenderHttpError(400, 'VALIDATION_ERROR', 'Provide both pageStart and pageEnd when narrowing a PDF import.'));
          return;
        }

        resolve({
          pdfBuffer: uploadBuffer,
          ...(pageStart !== undefined ? { pageStart } : {}),
          ...(pageEnd !== undefined ? { pageEnd } : {}),
        });
      });

      req.pipe(busboy);
    } catch {
      reject(new RenderHttpError(400, 'BAD_REQUEST', 'Failed to read the upload request.'));
    }
  });
}

export async function readPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const pdfDocument = await PDFDocument.load(buffer);
    return pdfDocument.getPageCount();
  } catch {
    throw buildPdfParseFailedError();
  }
}

export function resolvePdfPageRange(pageStart: number | undefined, pageEnd: number | undefined, pageCount: number): PdfDocumentPageRange | undefined {
  if (pageStart === undefined && pageEnd === undefined) {
    return undefined;
  }

  if (pageStart === undefined || pageEnd === undefined) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Provide both pageStart and pageEnd when narrowing a PDF import.');
  }

  if (pageStart < 1 || pageEnd < 1) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Page ranges must use 1-based page numbers.');
  }

  if (pageStart > pageEnd) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'pageStart must be less than or equal to pageEnd.');
  }

  if (pageEnd > pageCount) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', `Page range must stay within the uploaded PDF (1-${pageCount}).`);
  }

  return { start: pageStart, end: pageEnd };
}

export async function slicePdfBufferToPageRange(buffer: Buffer, pageRange: PdfDocumentPageRange): Promise<Buffer> {
  try {
    const sourcePdf = await PDFDocument.load(buffer);
    const targetPdf = await PDFDocument.create();
    const pageIndexes = Array.from({ length: pageRange.end - pageRange.start + 1 }, (_, index) => pageRange.start - 1 + index);
    const copiedPages = await targetPdf.copyPages(sourcePdf, pageIndexes);
    copiedPages.forEach(page => targetPdf.addPage(page));
    return Buffer.from(await targetPdf.save());
  } catch {
    throw buildPdfParseFailedError();
  }
}

export async function extractTextFromPdfBuffer(
  buffer: Buffer,
  ocrConfig: PdfOcrConfig = {},
): Promise<ExtractedPdfTextResult> {
  const parser = new PDFParse({ data: buffer });
  const resolvedOcrConfig = resolvePdfOcrConfig(ocrConfig);

  try {
    const result = await parser.getText();
    const extractedText = normalizeExtractedPdfText(result.text || '');

    if (extractedText.length >= MIN_EXTRACTED_PDF_TEXT_CHARS) {
      return {
        text: extractedText,
        warnings: [],
        usedOcr: false,
      };
    }

    if (!resolvedOcrConfig.enabled) {
      throw buildPdfTextNotFoundError();
    }

    return await extractTextWithOcr(parser, resolvedOcrConfig);
  } catch (error) {
    if (error instanceof RenderHttpError) {
      throw error;
    }

    throw new RenderHttpError(
      422,
      'PDF_PARSE_FAILED',
      'The uploaded PDF could not be read. Upload a valid PDF resume or try a cleaner export.',
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractTextWithOcr(parser: PDFParse, ocrConfig: ReturnType<typeof resolvePdfOcrConfig>): Promise<ExtractedPdfTextResult> {
  try {
    const screenshots = await parser.getScreenshot({
      first: ocrConfig.maxPages,
      desiredWidth: ocrConfig.imageWidth,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const pageBuffers = screenshots.pages
      .map(page => Buffer.from(page.data))
      .filter(pageBuffer => pageBuffer.length > 0);

    if (pageBuffers.length === 0) {
      throw buildPdfOcrTextNotFoundError();
    }

    const ocrResult = await ocrConfig.recognizePageBuffers(pageBuffers, ocrConfig);
    const extractedText = normalizeExtractedPdfText(ocrResult.text || '');

    if (extractedText.length < MIN_EXTRACTED_PDF_TEXT_CHARS) {
      throw buildPdfOcrTextNotFoundError();
    }

    const warnings: ResumeIntakeWarning[] = [
      {
        code: 'PDF_USED_OCR',
        message: 'This PDF was scanned or image-only, so OCR was used. Review names, dates, and bullet text carefully before applying.',
      },
    ];

    if (ocrResult.confidence < ocrConfig.lowConfidenceThreshold) {
      warnings.push({
        code: 'PDF_OCR_LOW_CONFIDENCE',
        message: `OCR confidence was low (${ocrResult.confidence}%). Review names, dates, and bullet text carefully before applying.`,
      });
    }

    return {
      text: extractedText,
      warnings,
      usedOcr: true,
      ocrConfidence: ocrResult.confidence,
    };
  } catch (error) {
    if (error instanceof RenderHttpError) {
      throw error;
    }

    throw new RenderHttpError(
      422,
      'PDF_OCR_FAILED',
      'This PDF appears to be scanned or image-only, but OCR failed. Try a clearer scan, enable OCR language data, or upload a text-based PDF resume.',
    );
  }
}

function buildPdfTextNotFoundError(): RenderHttpError {
  return new RenderHttpError(
    422,
    'PDF_TEXT_NOT_FOUND',
    'No extractable text was found in this PDF. It appears to be scanned or image-only. Enable PDF OCR on the server or upload a text-based PDF resume.',
  );
}

function buildPdfOcrTextNotFoundError(): RenderHttpError {
  return new RenderHttpError(
    422,
    'PDF_TEXT_NOT_FOUND',
    'This PDF appears to be scanned or image-only, but OCR could not recover enough text to build a draft. Try a clearer scan or upload a text-based PDF resume.',
  );
}

function looksLikePdf(filename: string, mimeType: string): boolean {
  return mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
}

function parseOptionalPageField(fieldName: string, values: string[] | undefined): number | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  if (values.length > 1) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', `${fieldName} must be provided at most once.`);
  }

  const value = values[0]?.trim();
  if (!value) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', `${fieldName} must be a positive integer.`);
  }

  if (!/^\d+$/.test(value)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', `${fieldName} must be a positive integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', `${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function buildPdfParseFailedError(): RenderHttpError {
  return new RenderHttpError(
    422,
    'PDF_PARSE_FAILED',
    'The uploaded PDF could not be read. Upload a valid PDF resume or try a cleaner export.',
  );
}

function normalizeExtractedPdfText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}