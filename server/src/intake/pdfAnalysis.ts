import { PdfDocumentAnalysis, PdfDocumentPageRange, PdfDocumentSignal, ResumeIntakeWarning } from './types.js';

const strongPacketPhraseMatchers = [
  /sample resumes\b/i,
  /resume samples\b/i,
  /resume packet/i,
  /example resumes\b/i,
];

const weakPacketPhraseMatchers = [
  /sample resume\b/i,
  /resume sample\b/i,
  /career services?/i,
  /resume guide/i,
];

const sectionHeadingMatchers = [
  'education',
  'experience',
  'employment',
  'professional experience',
  'work history',
  'skills',
  'technical skills',
  'projects',
  'objective',
  'summary',
  'profile',
  'certifications',
  'references',
];

const ignoredNameTokens = new Set([
  'resume',
  'sample',
  'samples',
  'packet',
  'guide',
  'career',
  'services',
  'objective',
  'references',
  'education',
  'experience',
  'skills',
  'projects',
  'summary',
  'profile',
  'professional',
  'technical',
  'university',
  'college',
  'school',
  'candidate',
  'frontend',
  'backend',
  'software',
  'engineer',
  'developer',
  'product',
  'designer',
  'manager',
  'analyst',
  'marketing',
  'business',
  'data',
  'analytics',
  'nurse',
  'nursing',
  'student',
  'specialist',
  'consultant',
]);

type AnalyzePdfDocumentOptions = {
  pageCount: number;
  extractedText: string;
  analyzedPageRange?: PdfDocumentPageRange;
};

export function analyzePdfDocument({
  pageCount,
  extractedText,
  analyzedPageRange,
}: AnalyzePdfDocumentOptions): PdfDocumentAnalysis {
  const text = extractedText.trim();
  const lowerText = text.toLowerCase();
  const emails = findDistinctEmails(text);
  const phones = findDistinctPhones(text);
  const nameCandidates = findNameCandidates(text);
  const strongPacketPhrases = strongPacketPhraseMatchers.filter(matcher => matcher.test(lowerText));
  const weakPacketPhrases = weakPacketPhraseMatchers.filter(matcher => matcher.test(lowerText));
  const repeatedSectionHeadings = findRepeatedSectionHeadings(text);
  const repeatedPacketHeadings = countMatches(lowerText, /\b(?:objective|references)\b/g);
  const credentialDensity = countMatches(lowerText, /\b(?:university|college|bachelor|master|associate|ph\.?d|certificate|certification|licensure|licensure|gpa)\b/g);
  const signals: PdfDocumentSignal[] = [];
  let packetScore = 0;
  let reviewScore = 0;

  if (strongPacketPhrases.length > 0) {
    packetScore += 4;
    signals.push({
      code: 'PACKET_PHRASES',
      message: 'The PDF includes packet-style phrases such as resume samples, resume packet, or career services.',
    });
  }

  if (weakPacketPhrases.length > 0) {
    reviewScore += 1;
    signals.push({
      code: 'SAMPLE_METADATA',
      message: 'The PDF includes sample-resume or career-services metadata that should lower confidence slightly without forcing a block on its own.',
    });
  }

  if (emails.length >= 2) {
    packetScore += 3;
    signals.push({
      code: 'MULTIPLE_EMAILS',
      message: `Detected ${emails.length} distinct email addresses in one PDF.`,
    });
  }

  if (phones.length >= 2) {
    packetScore += 2;
    signals.push({
      code: 'MULTIPLE_PHONES',
      message: `Detected ${phones.length} distinct phone numbers in one PDF.`,
    });
  }

  if (nameCandidates.length >= 3) {
    packetScore += 3;
    signals.push({
      code: 'MULTIPLE_NAME_CANDIDATES',
      message: `Detected ${nameCandidates.length} distinct name-like headings near the top of the extracted text.`,
    });
  } else if (nameCandidates.length === 2) {
    packetScore += 1;
    reviewScore += 1;
    signals.push({
      code: 'POSSIBLE_MULTIPLE_NAMES',
      message: 'Detected more than one strong candidate name in the extracted text.',
    });
  }

  if (pageCount >= 8) {
    packetScore += 2;
    signals.push({
      code: 'LONG_DOCUMENT',
      message: `The PDF is ${pageCount} pages long, which is unusual for a single resume upload.`,
    });
  } else if (pageCount >= 5) {
    packetScore += 2;
    reviewScore += 1;
    signals.push({
      code: 'MULTI_PAGE_DOCUMENT',
      message: `The PDF is ${pageCount} pages long and may include extra material beyond one resume.`,
    });
  }

  if (repeatedSectionHeadings.length >= 3) {
    packetScore += 2;
    signals.push({
      code: 'REPEATED_SECTION_HEADINGS',
      message: `Repeated section headings were detected across the extracted text (${repeatedSectionHeadings.map(entry => entry.heading).join(', ')}).`,
    });
  } else if (repeatedSectionHeadings.length >= 2) {
    reviewScore += 1;
    signals.push({
      code: 'REPEATED_SECTION_HEADINGS',
      message: 'More than one core section heading repeats in the extracted text, which may indicate multiple resumes.',
    });
  }

  if (repeatedPacketHeadings >= 2) {
    packetScore += 2;
    signals.push({
      code: 'REPEATED_PACKET_HEADINGS',
      message: 'Objective or references headings repeat, which is common in sample packs and resume guides.',
    });
  }

  if (pageCount >= 4 && credentialDensity >= 6) {
    reviewScore += 1;
    signals.push({
      code: 'DENSE_CREDENTIALS',
      message: 'The PDF contains many education or certification markers, which can indicate more than one profile.',
    });
  }

  const hasMultipleCandidateSignals = emails.length >= 2 || phones.length >= 2 || nameCandidates.length >= 2;

  let classification: PdfDocumentAnalysis['classification'] = 'single_resume';

  if (
    packetScore >= 7
    || (strongPacketPhrases.length > 0 && (pageCount >= 4 || repeatedSectionHeadings.length >= 2 || hasMultipleCandidateSignals))
    || (pageCount >= 6 && repeatedSectionHeadings.length >= 2)
    || (emails.length >= 2 && nameCandidates.length >= 2 && (pageCount >= 3 || repeatedSectionHeadings.length >= 1))
  ) {
    classification = 'likely_packet';
  } else if (
    packetScore + reviewScore >= 3
    || strongPacketPhrases.length > 0
    || repeatedSectionHeadings.length >= 2
    || (hasMultipleCandidateSignals && weakPacketPhrases.length > 0)
    || (pageCount >= 4 && text.length >= 7_000)
  ) {
    classification = 'uncertain';
  }

  return {
    pageCount,
    extractedTextChars: text.length,
    classification,
    signals,
    ...(analyzedPageRange ? { analyzedPageRange } : {}),
  };
}

export function buildPdfAnalysisWarnings(analysis: PdfDocumentAnalysis): ResumeIntakeWarning[] {
  const signalCodes = new Set(analysis.signals.map(signal => signal.code));
  const warnings: ResumeIntakeWarning[] = [];

  if (analysis.classification === 'likely_packet') {
    warnings.push({
      code: 'PDF_LIKELY_PACKET',
      message: 'This PDF looks like multiple resumes or a resume packet. Choose a page or page range before generating a draft.',
    });
  }

  if (
    signalCodes.has('MULTIPLE_EMAILS')
    || signalCodes.has('MULTIPLE_PHONES')
    || signalCodes.has('MULTIPLE_NAME_CANDIDATES')
    || signalCodes.has('POSSIBLE_MULTIPLE_NAMES')
  ) {
    warnings.push({
      code: 'PDF_MULTIPLE_CANDIDATES',
      message: 'This PDF appears to contain names or contact details for more than one person.',
    });
  }

  if (analysis.classification === 'uncertain') {
    warnings.push({
      code: 'PDF_REVIEW_REQUIRED',
      message: 'This PDF may include extra pages or ambiguous structure. Review the generated draft carefully before applying.',
    });
  }

  return warnings;
}

function findDistinctEmails(text: string): string[] {
  return uniqueMatches(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, value => value.toLowerCase());
}

function findDistinctPhones(text: string): string[] {
  return uniqueMatches(text, /(?:\+?\d[\d\s().-]{7,}\d)/g, normalizePhone).filter(phone => phone.length >= 10);
}

function findNameCandidates(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/[|•]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40);

  const seen = new Set<string>();
  const names: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (!looksLikePersonName(line)) continue;

    const nearbyLines = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join(' ');
    const nearContactLine = /@|linkedin\.com|github\.com|https?:\/\/|www\.|(?:\+?\d[\d\s().-]{7,}\d)/i.test(nearbyLines);
    if (!nearContactLine && index > 1) continue;

    const normalized = line.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(line);
  }

  return names;
}

function looksLikePersonName(line: string): boolean {
  if (line.length < 5 || line.length > 48) return false;
  if (line.includes('@') || /\d/.test(line) || /[:/]/.test(line)) return false;

  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;

  return tokens.every(token => {
    const cleaned = token.replace(/[.,]/g, '');
    const lower = cleaned.toLowerCase();
    if (!cleaned) return false;
    if (ignoredNameTokens.has(lower)) return false;
    return /^[A-Z][a-z'-]+$/.test(cleaned) || /^[A-Z]$/.test(cleaned);
  });
}

function findRepeatedSectionHeadings(text: string): Array<{ heading: string; count: number }> {
  const counts = new Map<string, number>();
  const lines = text
    .split(/\r?\n/)
    .map(line => line.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const line of lines) {
    const matchedHeading = sectionHeadingMatchers.find(heading => line === heading || line.startsWith(`${heading} `));
    if (!matchedHeading) continue;
    counts.set(matchedHeading, (counts.get(matchedHeading) || 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([heading, count]) => ({ heading, count }))
    .sort((left, right) => right.count - left.count || left.heading.localeCompare(right.heading));
}

function uniqueMatches(text: string, pattern: RegExp, normalize: (value: string) => string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const match of text.matchAll(pattern)) {
    const rawValue = match[0]?.trim();
    if (!rawValue) continue;

    const normalized = normalize(rawValue);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    values.push(normalized);
  }

  return values;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}