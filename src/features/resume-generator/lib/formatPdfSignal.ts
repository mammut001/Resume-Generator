import type { TranslationKey } from '@/i18n';
import type { PdfDocumentSignal } from '@/types/resume';

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

const signalKeyMap: Record<string, TranslationKey> = {
  PACKET_PHRASES: 'intake.signalMessages.packetPhrases',
  SAMPLE_METADATA: 'intake.signalMessages.sampleMetadata',
  MULTIPLE_EMAILS: 'intake.signalMessages.multipleEmails',
  MULTIPLE_PHONES: 'intake.signalMessages.multiplePhones',
  MULTIPLE_NAME_CANDIDATES: 'intake.signalMessages.multipleNameCandidates',
  POSSIBLE_MULTIPLE_NAMES: 'intake.signalMessages.possibleMultipleNames',
  LONG_DOCUMENT: 'intake.signalMessages.longDocument',
  MULTI_PAGE_DOCUMENT: 'intake.signalMessages.multiPageDocument',
  REPEATED_SECTION_HEADINGS: 'intake.signalMessages.repeatedSectionHeadings',
  REPEATED_PACKET_HEADINGS: 'intake.signalMessages.repeatedPacketHeadings',
  DENSE_CREDENTIALS: 'intake.signalMessages.denseCredentials',
};

function extractCount(message: string): number | undefined {
  const match = message.match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function formatPdfSignalMessage(signal: PdfDocumentSignal, t: TranslateFn): string {
  const key = signalKeyMap[signal.code];
  if (!key) return signal.message;

  const count = extractCount(signal.message);
  return count !== undefined ? t(key, { count }) : t(key);
}