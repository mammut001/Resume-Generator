import { createWorker } from 'tesseract.js';

export const DEFAULT_PDF_OCR_LANGUAGE = 'eng';
export const DEFAULT_PDF_OCR_MAX_PAGES = 2;
export const DEFAULT_PDF_OCR_IMAGE_WIDTH = 1600;
export const DEFAULT_PDF_OCR_LOW_CONFIDENCE_THRESHOLD = 80;

export type PdfOcrRecognition = {
  text: string;
  confidence: number;
};

export type PdfOcrRecognizer = (pageBuffers: Buffer[], options: ResolvedPdfOcrConfig) => Promise<PdfOcrRecognition>;

export type PdfOcrConfig = {
  enabled?: boolean;
  language?: string;
  maxPages?: number;
  imageWidth?: number;
  lowConfidenceThreshold?: number;
  recognizePageBuffers?: PdfOcrRecognizer;
};

export type ResolvedPdfOcrConfig = {
  enabled: boolean;
  language: string;
  maxPages: number;
  imageWidth: number;
  lowConfidenceThreshold: number;
  recognizePageBuffers: PdfOcrRecognizer;
};

export function resolvePdfOcrConfig(config: PdfOcrConfig = {}): ResolvedPdfOcrConfig {
  return {
    enabled: Boolean(config.enabled),
    language: config.language?.trim() || DEFAULT_PDF_OCR_LANGUAGE,
    maxPages: config.maxPages && config.maxPages > 0 ? Math.trunc(config.maxPages) : DEFAULT_PDF_OCR_MAX_PAGES,
    imageWidth: config.imageWidth && config.imageWidth > 0 ? Math.trunc(config.imageWidth) : DEFAULT_PDF_OCR_IMAGE_WIDTH,
    lowConfidenceThreshold: config.lowConfidenceThreshold && config.lowConfidenceThreshold > 0
      ? Math.trunc(config.lowConfidenceThreshold)
      : DEFAULT_PDF_OCR_LOW_CONFIDENCE_THRESHOLD,
    recognizePageBuffers: config.recognizePageBuffers || recognizePdfPageBuffers,
  };
}

export async function recognizePdfPageBuffers(
  pageBuffers: Buffer[],
  options: ResolvedPdfOcrConfig,
): Promise<PdfOcrRecognition> {
  if (pageBuffers.length === 0) {
    return { text: '', confidence: 0 };
  }

  const worker = await createWorker(options.language);

  try {
    const pageTexts: string[] = [];
    let totalConfidence = 0;

    for (const pageBuffer of pageBuffers) {
      const result = await worker.recognize(pageBuffer);
      pageTexts.push(result.data.text || '');
      totalConfidence += Number(result.data.confidence || 0);
    }

    return {
      text: pageTexts.join('\n\n'),
      confidence: Math.round(totalConfidence / pageBuffers.length),
    };
  } finally {
    await worker.terminate();
  }
}