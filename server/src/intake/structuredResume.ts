import { ResumeData } from './types.js';

const defaultDesign: ResumeData['design'] = {
  typography: 'classic',
  density: 'comfortable',
  pageSize: 'letter',
  accentColor: '#2563eb',
};

function designForSource(input: string): ResumeData['design'] {
  return {
    ...defaultDesign,
    pageSize: containsCjk(input) ? 'a4' : 'letter',
  };
}

type SectionKind = 'summary' | 'experience' | 'education' | 'projects' | 'skills';

const SECTION_HEADERS: Record<string, SectionKind> = {
  summary: 'summary',
  'professional summary': 'summary',
  profile: 'summary',
  objective: 'summary',
  '个人总结': 'summary',
  '自我评价': 'summary',
  '个人简介': 'summary',
  '摘要': 'summary',
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

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const YEAR_TOKEN = '\\d{4}(?:\\.\\d{1,2})?';
const CHINESE_DATE = `${YEAR_TOKEN}\\s*年(?:\\s*\\d{1,2}\\s*月)?`;
const ENGLISH_DATE = `(?:${MONTH}\\s+)?${YEAR_TOKEN}`;
const DATE_TOKEN = `(?:${CHINESE_DATE}|${ENGLISH_DATE})`;
const DATE_TOKEN_PATTERN = new RegExp(`^${DATE_TOKEN}$`, 'i');
const PRESENT_WORD = '(?:present|now|current|至今|现在)';
const PRESENT_PATTERN = new RegExp(`^${PRESENT_WORD}$`, 'i');
const DATE_RANGE_SEPARATOR = '(?:—|–|--|-|~|to|至)';
const DATE_RANGE_PATTERN = new RegExp(`^(${DATE_TOKEN})\\s*${DATE_RANGE_SEPARATOR}\\s*(${DATE_TOKEN}|${PRESENT_WORD})$`, 'i');
const TRAILING_DATE_RANGE_PATTERN = new RegExp(`^(.*\\S)\\s+(${DATE_TOKEN})\\s*${DATE_RANGE_SEPARATOR}\\s*(${DATE_TOKEN}|${PRESENT_WORD})$`, 'i');
const BULLET_PATTERN = /^(?:[-*•·]|\u2013)\s+(.+)$/;
const ENGLISH_NAME_PATTERN = /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,2}$/;
const CHINESE_NAME_PATTERN = /^[\u4e00-\u9fff·]{2,4}$/;
const MIXED_NAME_PATTERN = /^(?:[\u4e00-\u9fff·]{2,4}\s+[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,2}|[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,2}\s+[\u4e00-\u9fff·]{2,4})$/;

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
    design: designForSource(input),
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
    .trim();
  const direct = lookupHeader(normalized);
  if (direct) return direct;

  const parts = normalized.split(/\s*(?:\/|\||｜)\s*/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  for (const part of parts) {
    const kind = lookupHeader(part);
    if (kind) return kind;
  }
  return null;
}

function lookupHeader(value: string): SectionKind | null {
  return SECTION_HEADERS[value.toLowerCase()] ?? SECTION_HEADERS[value] ?? null;
}

function parseHeader(lines: string[], chinese: boolean): ResumeData['personal'] {
  const content = lines.map(line => line.trim()).filter(Boolean);
  let fullName = 'Imported Candidate';
  let headline = '';
  let email = '';
  let phone = '';
  let location = '';
  let website: string | undefined;
  let extraLink: string | undefined;
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
        if (consumed.website) {
          const assigned = assignWebsite(website, extraLink, consumed.website);
          website = assigned.website;
          extraLink = assigned.extraLink;
        }
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
    ...(extraLink ? { extraLink } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
  };
}

function looksLikeName(line: string): boolean {
  return ENGLISH_NAME_PATTERN.test(line) || CHINESE_NAME_PATTERN.test(line) || MIXED_NAME_PATTERN.test(line);
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

function assignWebsite(website: string | undefined, extraLink: string | undefined, next: string): { website?: string; extraLink?: string } {
  if (!website) return { website: next, extraLink };
  if (website === next) return { website, extraLink };

  if (isSocialProfile(website) && !isSocialProfile(next)) {
    return { website: next, extraLink: extraLink || website };
  }

  if (!extraLink) return { website, extraLink: next };
  return { website, extraLink };
}

function isSocialProfile(value: string): boolean {
  return /(?:dribbble|twitter|facebook|instagram)\.com/i.test(value);
}

type HeaderShape = 'role-org' | 'dated-left' | 'org-location';

type HeaderParse = DatedEntry & { shape: HeaderShape };

function parseDatedSection(lines: string[], kind: 'experience' | 'education'): DatedEntry[] {
  const entries: DatedEntry[] = [];
  let entry: DatedEntry | null = null;
  let pendingSchool: { school: string; location?: string } | null = null;

  const commit = () => {
    if (entry?.left && entry.right) entries.push(entry);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || /^[-=_*]{3,}$/.test(line)) continue;
    const nextLine = lines.slice(index + 1).map(candidate => candidate.trim()).find(Boolean);
    const active = entry;

    const bullet = line.match(BULLET_PATTERN)?.[1]?.trim();
    if (bullet) {
      if (!active) continue;
      const list = kind === 'experience' ? active.bullets : active.details;
      list.push(bullet);
      continue;
    }

    if (isPureDateRange(line) && active) {
      const dates = parseDateRange(line);
      if (dates) {
        active.startDate = dates.startDate;
        active.endDate = dates.endDate;
        active.current = dates.current;
      }
      continue;
    }

    const header = parseHeaderLine(line);
    if (header?.shape === 'org-location') {
      if (kind === 'experience' && active && !active.right) {
        active.right = header.left;
        active.location = header.location || active.location;
        continue;
      }
      if (kind === 'education') {
        if (active && !active.right) {
          active.right = header.left;
          active.location = header.location || active.location;
        } else {
          pendingSchool = { school: header.left, location: header.location };
        }
        continue;
      }
    }

    if (header?.shape === 'dated-left' || header?.shape === 'role-org') {
      commit();
      const school = kind === 'education' ? pendingSchool : null;
      entry = {
        left: header.left,
        right: header.right || school?.school || '',
        location: header.location || school?.location,
        startDate: header.startDate,
        endDate: header.endDate,
        current: header.current,
        bullets: [],
        details: [],
      };
      pendingSchool = null;
      continue;
    }

    if (active && isWrappedContinuation(line, lastEntryText(active, kind), nextLine)) {
      appendContinuation(active, kind, line);
      continue;
    }

    if (active && kind === 'experience' && !active.right) {
      active.right = line;
      continue;
    }

    if (active && kind === 'education' && !active.right) {
      active.right = line;
      continue;
    }

    if (active && kind === 'education') active.details.push(line);
  }

  commit();
  return entries;
}

function lastEntryText(entry: DatedEntry, kind: 'experience' | 'education'): string {
  const list = kind === 'experience' ? entry.bullets : entry.details;
  return list.at(-1) || '';
}

function appendContinuation(entry: DatedEntry, kind: 'experience' | 'education', line: string) {
  const list = kind === 'experience' ? entry.bullets : entry.details;
  const previous = list.at(-1);
  if (!previous) return;
  list[list.length - 1] = joinWrapped(previous, line);
}

function isWrappedContinuation(line: string, previous: string, nextLine: string | undefined): boolean {
  if (!previous || /[.。！!？?；;]$/.test(previous.trim())) return false;
  if (parseHeaderLine(line) || classifyHeader(line) || isPureDateRange(line)) return false;
  if (/^[a-z0-9(（]/.test(line)) return true;

  const previousLast = previous.trim().at(-1) || '';
  const nextFirst = line.trim()[0] || '';
  if (!isCjk(previousLast) || !isCjk(nextFirst)) return false;
  const upcoming = nextLine?.trim() || '';
  if (line.trim().length <= 30 && upcoming && (BULLET_PATTERN.test(upcoming) || classifyHeader(upcoming))) return false;
  return true;
}

function parseHeaderLine(line: string): HeaderParse | null {
  const segments = line.split(/\t|\|/).map(part => part.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  const dateIndex = segments.findIndex(segment => isPureDateRange(segment));
  const dates = dateIndex >= 0 ? parseDateRange(segments[dateIndex]) : null;
  const rest = segments.filter((_, index) => index !== dateIndex);
  if (rest.length === 0) return null;

  const roleOrg = splitRoleOrg(rest[0]);
  if (roleOrg) {
    const organization = splitTrailingLocation(roleOrg.right);
    const location = rest.slice(1).find(part => !isPureDateRange(part)) || organization.location;
    return headerEntry(roleOrg.left, organization.value, location || organization.location, dates, 'role-org');
  }

  const peeled = peelTrailingDate(rest[0]);
  if (peeled) {
    return headerEntry(peeled.left, '', rest[1], peeled.dates, 'dated-left');
  }

  if (dates) {
    return headerEntry(rest[0], '', rest[1], dates, 'dated-left');
  }

  if (line.includes('\t') && rest.length >= 2 && !line.includes('|')) {
    return headerEntry(rest[0], '', rest.slice(1).join(' '), null, 'org-location');
  }

  return null;
}

function headerEntry(
  left: string,
  right: string,
  location: string | undefined,
  dates: { startDate: string; endDate: string; current: boolean } | null,
  shape: HeaderShape,
): HeaderParse {
  return {
    left,
    right,
    ...(location ? { location } : {}),
    startDate: dates?.startDate || '',
    endDate: dates?.endDate || '',
    current: Boolean(dates?.current),
    bullets: [],
    details: [],
    shape,
  };
}

function splitRoleOrg(value: string): { left: string; right: string } | null {
  if (peelTrailingDate(value)) return null;
  const match = value.match(/^(.+?)\s+(?:—|–|--|-)\s+(.+)$/);
  if (!match) return null;
  const left = match[1].trim();
  const right = match[2].trim();
  if (!left || !right || looksLikeDateToken(left) || looksLikeDateToken(right) || PRESENT_PATTERN.test(right)) return null;
  return { left, right };
}

function peelTrailingDate(value: string): { left: string; dates: { startDate: string; endDate: string; current: boolean } } | null {
  const withMonth = value.match(new RegExp(`^(.*\\S)\\s+((?:${MONTH}\\s+${YEAR_TOKEN})|${CHINESE_DATE})\\s*${DATE_RANGE_SEPARATOR}\\s*(${DATE_TOKEN}|${PRESENT_WORD})$`, 'i'));
  const match = withMonth || value.match(TRAILING_DATE_RANGE_PATTERN);
  if (!match) return null;
  const dates = parseDateRange(`${match[2]} - ${match[3]}`);
  const left = match[1].trim();
  if (!dates || !left || looksLikeDateToken(left)) return null;
  return { left, dates };
}

function splitTrailingLocation(value: string): { value: string; location?: string } {
  const match = value.match(/^(.*\S)\s+\(([^()]+)\)\s*$/);
  if (!match) return { value: value.trim() };
  return { value: match[1].trim(), location: match[2].trim() };
}

function parseDateRange(value: string): { startDate: string; endDate: string; current: boolean } | null {
  const trimmed = value.trim();
  const range = trimmed.match(DATE_RANGE_PATTERN);
  if (range) {
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

function isPureDateRange(value: string): boolean {
  return DATE_RANGE_PATTERN.test(value.trim());
}

function looksLikeDateToken(value: string): boolean {
  return DATE_TOKEN_PATTERN.test(value.trim());
}

function parseProjects(lines: string[]): ResumeData['projects'] {
  const projects: ResumeData['projects'] = [];
  let current: { name: string; description: string; url?: string; bullets: string[] } | null = null;

  const push = () => {
    if (!current?.name) return;
    projects.push({
      id: `project-${projects.length + 1}`,
      name: current.name,
      description: current.description,
      ...(current.url ? { url: current.url } : {}),
      bullets: current.bullets,
    });
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const nextLine = lines.slice(index + 1).map(candidate => candidate.trim()).find(Boolean);
    const bullet = line.match(BULLET_PATTERN)?.[1]?.trim();
    if (bullet) {
      if (!current) continue;
      current.bullets.push(bullet);
      continue;
    }

    if (current && current.bullets.length > 0 && isWrappedContinuation(line, current.bullets.at(-1) || '', nextLine)) {
      current.bullets[current.bullets.length - 1] = joinWrapped(current.bullets.at(-1) || '', line);
      continue;
    }

    if (current && current.description && current.bullets.length === 0 && isWrappedContinuation(line, current.description, nextLine)) {
      current.description = joinWrapped(current.description, line);
      continue;
    }

    if (current && !current.description && current.bullets.length === 0 && !parseProjectHeading(line).url) {
      current.description = line;
      continue;
    }

    push();
    const heading = parseProjectHeading(line);
    current = { name: heading.name, description: '', bullets: [], ...(heading.url ? { url: heading.url } : {}) };
  }

  push();
  return projects;
}

function parseProjectHeading(line: string): { name: string; url?: string } {
  const [left, right] = line.split('\t').map(part => part.trim()).filter(Boolean);
  if (right && normalizeLink(right)) return { name: left, url: normalizeLink(right) || undefined };
  const trailing = line.match(/^(.*\S)\s+((?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S+)?)$/i);
  if (trailing) {
    const url = normalizeLink(trailing[2]);
    if (url && trailing[1].trim()) return { name: trailing[1].trim(), url };
  }
  return { name: line.trim() };
}

function parseSkills(lines: string[], chinese: boolean): ResumeData['skills'] {
  const meaningful = lines
    .map(line => line.trim())
    .filter(line => line && !BULLET_PATTERN.test(line) && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
  if (meaningful.length === 0) return [];

  const fallback = chinese ? '技能' : 'Skills';
  const groups: Array<{ category: string; raw: string }> = [];
  let flat = '';

  const append = (raw: string, chunk: string) => joinWrapped(raw, chunk.trim());

  for (const line of meaningful) {
    const labels = findSkillLabels(line);
    if (labels.length === 0) {
      if (groups.length > 0) groups[groups.length - 1].raw = append(groups[groups.length - 1].raw, line);
      else flat = append(flat, line);
      continue;
    }

    const leading = line.slice(0, labels[0].labelStart).trim();
    if (leading) {
      if (groups.length > 0) groups[groups.length - 1].raw = append(groups[groups.length - 1].raw, leading);
      else flat = append(flat, leading);
    }

    labels.forEach((label, index) => {
      const end = index + 1 < labels.length ? labels[index + 1].labelStart : line.length;
      groups.push({
        category: label.category,
        raw: line.slice(label.contentStart, end).trim(),
      });
    });
  }

  const result: ResumeData['skills'] = [];
  const pushGroup = (category: string, rawItems: string) => {
    const items = uniqueItems(splitSkillItems(rawItems));
    if (items.length === 0) return;
    result.push({
      id: `skill-${result.length + 1}`,
      category: category.trim() || fallback,
      items,
    });
  };

  if (flat.trim()) pushGroup(fallback, flat);
  groups.forEach(group => pushGroup(group.category, group.raw));
  return result;
}

function findSkillLabels(text: string): Array<{ category: string; labelStart: number; contentStart: number }> {
  const labels: Array<{ category: string; labelStart: number; contentStart: number }> = [];
  for (const match of text.matchAll(/[:：]/g)) {
    const colonAt = match.index ?? 0;
    const parsed = categoryEndingAt(text, colonAt);
    if (!parsed) continue;
    const whitespace = text.slice(colonAt + 1).match(/^\s*/)?.[0].length ?? 0;
    labels.push({
      category: parsed.category,
      labelStart: parsed.start,
      contentStart: colonAt + 1 + whitespace,
    });
  }
  return labels;
}

function categoryEndingAt(text: string, colonAt: number): { category: string; start: number } | null {
  const before = text.slice(Math.max(0, colonAt - 48), colonAt);
  const cjk = before.match(/([\u4e00-\u9fff]{2,20})$/);
  const latin = before.match(/((?:[A-Z][A-Za-z0-9.+#/]*|&)(?:\s+(?:[A-Z][A-Za-z0-9.+#/]*|&)){0,5})$/);
  const chosen = cjk || latin;
  if (!chosen?.[1]) return null;
  const category = chosen[1].trim();
  if (!category || /[,，、]/.test(category)) return null;
  return { category, start: colonAt - chosen[1].length };
}

function uniqueItems(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
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
  return joinWrappedLines(lines.map(line => line.trim()).filter(Boolean));
}

function joinWrappedLines(lines: string[]): string {
  return lines.reduce((combined, line) => joinWrapped(combined, line), '');
}

function joinWrapped(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const previous = left.at(-1) || '';
  const next = right[0] || '';
  if (isCjk(previous) && isCjk(next)) return `${left}${right}`;
  return `${left} ${right}`;
}

function isCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}
