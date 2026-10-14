import { ResumeData } from './types.js';

const defaultDesign: ResumeData['design'] = {
  typography: 'classic',
  density: 'comfortable',
  pageSize: 'letter',
  accentColor: '#2563eb',
};

type SectionKind = 'summary' | 'experience' | 'education' | 'projects' | 'skills';

const SECTION_HEADERS: Record<string, SectionKind> = {
  summary: 'summary',
  'professional summary': 'summary',
  profile: 'summary',
  objective: 'summary',
  '个人总结': 'summary',
  '自我评价': 'summary',
  '个人简介': 'summary',
  experience: 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  employment: 'experience',
  'employment history': 'experience',
  'work history': 'experience',
  '工作经历': 'experience',
  '工作经验': 'experience',
  '实习经历': 'experience',
  '实习经验': 'experience',
  education: 'education',
  'education background': 'education',
  '教育背景': 'education',
  '教育经历': 'education',
  projects: 'projects',
  'personal projects': 'projects',
  'project experience': 'projects',
  '项目经历': 'projects',
  '项目经验': 'projects',
  '项目': 'projects',
  skills: 'skills',
  'technical skills': 'skills',
  '技能': 'skills',
  '专业技能': 'skills',
  '技能特长': 'skills',
};

type DatedEntry = {
  left: string;
  right: string;
  location?: string;
  startDate: string;
  endDate: string;
  current: boolean;
  bullets: string[];
  details: string[];
};

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const DATE_TOKEN = `(?:${MONTH}\\s+)?\\d{4}(?:\\.\\d{1,2})?`;
const DATE_TOKEN_PATTERN = new RegExp(`^${DATE_TOKEN}$`, 'i');
const PRESENT_PATTERN = /^(?:present|now|current|至今)$/i;
const BULLET_PATTERN = /^(?:[-*•·]|\u2013)\s+(.+)$/;
const ENGLISH_NAME_PATTERN = /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,2}$/;
const CHINESE_NAME_PATTERN = /^[\u4e00-\u9fff·]{2,4}$/;

export function parseStructuredResume(input: string): ResumeData | null {
  const lines = normalizeLines(input);
  if (lines.length === 0) return null;

  const buckets: Record<SectionKind, string[]> = {
    summary: [],
    experience: [],
    education: [],
    projects: [],
    skills: [],
  };
  const headerLines: string[] = [];
  let current: SectionKind | null = null;
  let headerCount = 0;

  for (const line of lines) {
    const section = classifyHeader(line);
    if (section) {
      current = section;
      headerCount += 1;
      continue;
    }

    if (!current) headerLines.push(line);
    else buckets[current].push(line);
  }

  if (headerCount < 2) return null;

  const experience = parseDatedSection(buckets.experience, 'experience');
  const education = parseDatedSection(buckets.education, 'education');
  const projects = parseProjects(buckets.projects);
  if (experience.length + education.length + projects.length === 0) return null;

  const personal = parseHeader(headerLines, containsCjk(input));
  const summary = joinParagraph(buckets.summary);
  const skills = parseSkills(buckets.skills, containsCjk(input));
  const headline = personal.headline;

  return {
    id: 'intake-structured',
    title: `${headline} Resume`,
    templateId: 'clean-professional',
    design: defaultDesign,
    personal,
    summary,
    experience: experience.map((entry, index) => ({
      id: `exp-${index + 1}`,
      company: entry.right,
      role: entry.left,
      ...(entry.location ? { location: entry.location } : {}),
      startDate: entry.startDate,
      endDate: entry.endDate,
      current: entry.current,
      bullets: entry.bullets,
    })),
    education: education.map((entry, index) => ({
      id: `edu-${index + 1}`,
      school: entry.right,
      degree: entry.left,
      ...(entry.location ? { location: entry.location } : {}),
      ...(entry.startDate ? { startDate: entry.startDate } : {}),
      ...(entry.endDate ? { endDate: entry.endDate } : {}),
      ...(entry.details.length ? { details: entry.details } : {}),
    })),
    skills,
    projects,
  };
}

function normalizeLines(input: string): string[] {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0));
}

function classifyHeader(line: string): SectionKind | null {
  const normalized = line
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^[*_]+|[*_]+$/g, '')
    .replace(/[:：]\s*$/, '')
    .trim()
    .toLowerCase();
  return SECTION_HEADERS[normalized] ?? null;
}

function parseHeader(lines: string[], chinese: boolean): ResumeData['personal'] {
  const content = lines.map(line => line.trim()).filter(Boolean);
  let fullName = 'Imported Candidate';
  let headline = '';
  let email = '';
  let phone = '';
  let location = '';
  let website: string | undefined;
  let linkedin: string | undefined;
  let github: string | undefined;

  content.forEach((line, index) => {
    if (index === 0 && looksLikeName(line)) {
      fullName = line;
      return;
    }

    if (isContactLine(line)) {
      for (const segment of line.split('|').map(part => part.trim()).filter(Boolean)) {
        const consumed = consumeContactSegment(segment);
        if (consumed.email && !email) email = consumed.email;
        if (consumed.phone && !phone) phone = consumed.phone;
        if (consumed.location && !location) location = consumed.location;
        if (consumed.linkedin && !linkedin) linkedin = consumed.linkedin;
        if (consumed.github && !github) github = consumed.github;
        if (consumed.website) website = preferWebsite(website, consumed.website);
      }
      return;
    }

    if (!headline) headline = line;
  });

  if (!headline) headline = chinese ? '简历候选人' : 'Resume Candidate';

  return {
    fullName,
    headline,
    email,
    phone,
    location,
    ...(website ? { website } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
  };
}

function looksLikeName(line: string): boolean {
  return ENGLISH_NAME_PATTERN.test(line) || CHINESE_NAME_PATTERN.test(line);
}

function isContactLine(line: string): boolean {
  if (line.includes('@') || line.includes('|')) return true;
  if (/\b(?:linkedin|github|dribbble)\.com\b/i.test(line)) return true;
  if (isPhone(line)) return true;
  return Boolean(normalizeLink(line));
}

function consumeContactSegment(segment: string): {
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
} {
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(segment)) return { email: segment };
  if (isPhone(segment)) return { phone: segment };

  const link = normalizeLink(segment);
  if (link) {
    if (/linkedin\.com/i.test(link)) return { linkedin: link };
    if (/github\.com/i.test(link)) return { github: link };
    return { website: link };
  }

  if (!parseDateRange(segment)) return { location: segment };
  return {};
}

function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && /^[+\d\s().-]+$/.test(value);
}

function normalizeLink(value: string): string | null {
  const stripped = value
    .replace(/^(?:博客|个人网站|个人主页|主页|website|portfolio|blog|site)\s*[:：]\s*/i, '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(stripped)) return null;
  return stripped;
}

function preferWebsite(current: string | undefined, next: string): string {
  if (!current) return next;
  const currentSocial = isSocialProfile(current);
  if (currentSocial && !isSocialProfile(next)) return next;
  return current;
}

function isSocialProfile(value: string): boolean {
  return /(?:dribbble|twitter|facebook|instagram)\.com/i.test(value);
}

function parseDatedSection(lines: string[], kind: 'experience' | 'education'): DatedEntry[] {
  const entries: DatedEntry[] = [];
  let current: DatedEntry | null = null;

  const push = () => {
    if (!current) return;
    if (current.left && current.right) entries.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^[-=_*]{3,}$/.test(line)) continue;

    const bullet = line.match(BULLET_PATTERN)?.[1]?.trim();
    if (bullet) {
      if (!current) continue;
      if (kind === 'experience') current.bullets.push(bullet);
      else current.details.push(bullet);
      continue;
    }

    const header = parseHeaderLine(line);
    if (header) {
      push();
      current = header;
      continue;
    }

    const dates = parseDateRange(line);
    if (dates && current) {
      current.startDate = dates.startDate;
      current.endDate = dates.endDate;
      current.current = dates.current;
      continue;
    }

    if (current && kind === 'education') current.details.push(line);
  }

  push();
  return entries;
}

function parseHeaderLine(line: string): DatedEntry | null {
  const parts = line.split('|').map(part => part.trim()).filter(Boolean);
  const roleOrg = splitRoleOrg(parts[0] || '');
  if (!roleOrg) return null;

  let location: string | undefined;
  let dates: { startDate: string; endDate: string; current: boolean } | null = null;
  for (const part of parts.slice(1)) {
    const parsedDates = parseDateRange(part);
    if (parsedDates) dates = parsedDates;
    else if (!location) location = part;
  }

  const organization = splitTrailingLocation(roleOrg.right);
  return {
    left: roleOrg.left,
    right: organization.value,
    location: location || organization.location,
    startDate: dates?.startDate || '',
    endDate: dates?.endDate || '',
    current: Boolean(dates?.current),
    bullets: [],
    details: [],
  };
}

function splitRoleOrg(value: string): { left: string; right: string } | null {
  const match = value.match(/^(.+?)\s+(?:—|–|--|-)\s+(.+)$/);
  if (!match) return null;
  const left = match[1].trim();
  const right = match[2].trim();
  if (!left || !right || looksLikeDateToken(left)) return null;
  return { left, right };
}

function splitTrailingLocation(value: string): { value: string; location?: string } {
  const match = value.match(/^(.*\S)\s+\(([^()]+)\)\s*$/);
  if (!match) return { value: value.trim() };
  return { value: match[1].trim(), location: match[2].trim() };
}

function parseDateRange(value: string): { startDate: string; endDate: string; current: boolean } | null {
  const trimmed = value.trim();
  const range = trimmed.match(/^(.+?)\s*(?:—|–|-)\s*(.+)$/);
  if (range && looksLikeDateToken(range[1]) && (looksLikeDateToken(range[2]) || PRESENT_PATTERN.test(range[2].trim()))) {
    const current = PRESENT_PATTERN.test(range[2].trim());
    return {
      startDate: range[1].trim(),
      endDate: current ? '' : range[2].trim(),
      current,
    };
  }

  if (looksLikeDateToken(trimmed)) {
    return { startDate: trimmed, endDate: '', current: false };
  }

  return null;
}

function looksLikeDateToken(value: string): boolean {
  return DATE_TOKEN_PATTERN.test(value.trim());
}

function parseProjects(lines: string[]): ResumeData['projects'] {
  const projects: ResumeData['projects'] = [];
  let current: { name: string; description: string; bullets: string[] } | null = null;

  const push = () => {
    if (!current?.name) return;
    projects.push({
      id: `project-${projects.length + 1}`,
      name: current.name,
      description: current.description,
      bullets: current.bullets,
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const bullet = line.match(BULLET_PATTERN)?.[1]?.trim();
    if (bullet) {
      if (!current) continue;
      current.bullets.push(bullet);
      continue;
    }

    if (current && !current.description && current.bullets.length === 0) {
      current.description = line;
      continue;
    }

    push();
    current = { name: line, description: '', bullets: [] };
  }

  push();
  return projects;
}

function parseSkills(lines: string[], chinese: boolean): ResumeData['skills'] {
  const groups: ResumeData['skills'] = [];
  const flat: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || BULLET_PATTERN.test(line) || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;

    const labeled = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
    if (labeled && !/[,，、]/.test(labeled[1])) {
      const items = splitSkillItems(labeled[2]);
      if (items.length > 0) {
        groups.push({
          id: `skill-${groups.length + 1}`,
          category: labeled[1].trim(),
          items,
        });
      }
      continue;
    }

    flat.push(...splitSkillItems(line));
  }

  if (flat.length > 0) {
    groups.push({
      id: `skill-${groups.length + 1}`,
      category: chinese ? '技能' : 'Skills',
      items: Array.from(new Set(flat)),
    });
  }

  return groups;
}

function splitSkillItems(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if ('（(['.includes(char)) depth += 1;
    if ('）)]'.includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || char === '，' || char === '、')) {
      if (current.trim()) items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

function joinParagraph(lines: string[]): string {
  return lines.map(line => line.trim()).filter(Boolean).join(' ');
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}
