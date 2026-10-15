import { IncomingMessage } from 'node:http';
import Busboy from 'busboy';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFParse } from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { RenderHttpError } from '../lib/errors.js';
import { PdfOcrConfig, resolvePdfOcrConfig } from './pdfOcr.js';
import { PdfDocumentPageRange, ResumeIntakeWarning } from './types.js';

const MIN_EXTRACTED_PDF_TEXT_CHARS = 20;
const PDF_LINE_THRESHOLD = 4.6;
const PDF_COLUMN_GAP = 12;

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
    const extractedText = normalizeExtractedPdfText(await extractLayoutText(buffer));

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

async function extractLayoutText(buffer: Buffer): Promise<string> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
  });
  const document = await loadingTask.promise;

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      pages.push(await extractPageLayoutText(page));
      page.cleanup();
    }
    return pages.join('\n');
  } finally {
    await document.destroy();
  }
}

type LayoutTextItem = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

function isLayoutTextItem(item: unknown): item is LayoutTextItem {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as { str?: unknown; transform?: unknown };
  return typeof candidate.str === 'string' && Array.isArray(candidate.transform);
}

type LayoutGlyph = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  eol: boolean;
};

async function extractPageLayoutText(page: pdfjs.PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });
  const glyphs: LayoutGlyph[] = [];

  for (const item of textContent.items) {
    if (!isLayoutTextItem(item)) continue;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4] || 0, item.transform[5] || 0);
    const width = item.width || 0;
    glyphs.push({
      text: item.str,
      x,
      y,
      width,
      height: item.height || 0,
      eol: Boolean(item.hasEOL),
    });
  }

  const prepared = mergeWrappedCjkLabels(glyphs);
  const chunks: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;

  for (let index = 0; index < prepared.length; index += 1) {
    const glyph = prepared[index];
    const next = prepared[index + 1];
    let text = glyph.text;
    const label = isSkillLabelGlyph(glyph, next);

    if (lastY !== undefined && Math.abs(lastY - glyph.y) > PDF_LINE_THRESHOLD) {
      const lastItem = chunks.at(-1);
      const startsNewLine = text.startsWith('\n') || text.trim() === '';
      if (lastItem?.endsWith('\n') === false && !startsNewLine && Math.abs(lastY - glyph.y) - 1 > lineHeight) {
        chunks.push('\n');
        lineHeight = 0;
      }
    }

    const sameLine = lastY !== undefined && Math.abs(lastY - glyph.y) < PDF_LINE_THRESHOLD;
    const wideSpace = text.trim() === '' && glyph.width >= PDF_COLUMN_GAP;
    const columnGap = sameLine && lastX !== undefined && glyph.x - lastX > PDF_COLUMN_GAP;
    const lineStart = chunks.length === 0 || Boolean(chunks.at(-1)?.endsWith('\n'));
    if (!lineStart && label) {
      chunks.push('\n');
      lineHeight = 0;
    }

    if (wideSpace) text = '\t';
    else if (columnGap && text.trim() !== '' && !label) text = `\t${text}`;

    chunks.push(text);
    lastX = glyph.x + glyph.width;
    lastY = glyph.y;
    lineHeight = Math.max(lineHeight, glyph.height);
    if (glyph.eol) chunks.push('\n');
    if (glyph.eol || text.endsWith('\n')) lineHeight = 0;
  }

  return chunks.join('');
}

function mergeWrappedCjkLabels(glyphs: LayoutGlyph[]): LayoutGlyph[] {
  const merged: LayoutGlyph[] = [];
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const next = glyphs[index + 1];
    if (
      next
      && /^[\u4e00-\u9fff]{1,2}$/.test(glyph.text.trim())
      && /^[\u4e00-\u9fff]/.test(next.text.trim())
      && Math.abs(next.y - glyph.y) > PDF_LINE_THRESHOLD
      && glyph.x > 180
    ) {
      next.text = `${glyph.text.trim()}${next.text.trim()}`;
      continue;
    }
    merged.push(glyph);
  }
  return merged;
}

function isSkillLabelGlyph(glyph: LayoutGlyph, next: LayoutGlyph | undefined): boolean {
  const text = glyph.text.trim();
  if (!text || text.length > 40 || /[,，、]/.test(text)) return false;
  if (/[:：]$/.test(text) && /[A-Za-z\u4e00-\u9fff]/.test(text)) return true;
  return Boolean(next && /^[:：]$/.test(next.text.trim()) && /^[\u4e00-\u9fffA-Za-z0-9 &/+.#-]{2,40}$/.test(text));
}

function normalizeExtractedPdfText(text: string): string {
  const cleaned = text
    .replaceAll('\u0000', ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\r/g, '\n');
  return repairWrappedPdfColumns(cleaned)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .trim();
}

function repairWrappedPdfColumns(text: string): string {
  const lines = text.split('\n');
  const repaired: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const next = lines[index + 1];
    if (!next) {
      repaired.push(line);
      continue;
    }

    const hangingPresent = next.match(/^(至今|现在|Present|Now)(?=\s|\t|$|[^\s])/i);
    if (/[–—-]\s*$/.test(line) && hangingPresent) {
      line = `${line.replace(/\s+$/, '')} ${hangingPresent[1]}`;
      lines[index + 1] = next.slice(hangingPresent[1].length).replace(/^\s+/, '');
    } else if (/(?:年\s*)?\d{1,2}\s*$/.test(line) && /^月(?=\s|\t|$|[\u4e00-\u9fff])/.test(next)) {
      line = `${line.replace(/\s+$/, '')} 月`;
      lines[index + 1] = next.slice(1).replace(/^\s+/, '');
    }

    repaired.push(line);
  }

  return repaired.join('\n');
}