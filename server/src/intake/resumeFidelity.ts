import { ResumeData, ResumeProject } from './types.js';

export function sanitizeIntakeResume(resume: ResumeData, sourceText: string): ResumeData {
  const personal = sanitizePersonal(resume.personal, sourceText);
  return {
    ...resume,
    personal,
    summary: sanitizeSummary(resume.summary, personal.fullName, sourceText),
    experience: resume.experience.map(entry => ({
      ...entry,
      bullets: restoreSourceBullets(entry.bullets, sourceText),
    })),
    skills: sanitizeSkills(resume.skills, sourceText),
    projects: resume.projects.map(project => sanitizeProject(project, sourceText)),
  };
}

export function websiteIsInSource(website: string, sourceText: string): boolean {
  const normalized = website
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
  if (normalized.length < 3) return false;
  return sourceWithoutEmails(sourceText).toLowerCase().includes(normalized.toLowerCase());
}

function sanitizePersonal(personal: ResumeData['personal'], sourceText: string): ResumeData['personal'] {
  let website = personal.website?.trim();
  let extraLink = personal.extraLink?.trim();
  let linkedin = personal.linkedin;
  let github = personal.github;

  if (website && /linkedin\.com/i.test(website) && !linkedin) {
    linkedin = website.replace(/^https?:\/\//i, '');
    website = undefined;
  }

  if (website && /github\.com/i.test(website) && !github) {
    github = website.replace(/^https?:\/\//i, '');
    website = undefined;
  }

  if (website && !websiteIsInSource(website, sourceText)) website = undefined;
  if (extraLink && (!websiteIsInSource(extraLink, sourceText) || extraLink === website)) extraLink = undefined;

  return {
    fullName: personal.fullName,
    headline: personal.headline,
    email: personal.email,
    phone: personal.phone,
    location: personal.location,
    ...(website ? { website } : {}),
    ...(extraLink ? { extraLink } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
  };
}

function sanitizeSummary(summary: string, fullName: string, sourceText: string): string {
  const trimmed = summary.trim();
  if (!trimmed || !fullName || fullName === 'Imported Candidate') return trimmed;
  if (sourceText.includes(trimmed)) return trimmed;
  if (!trimmed.startsWith(fullName)) return trimmed;

  const withoutName = trimmed.slice(fullName.length).replace(/^(?:是一名|是一位|是|is an|is a|is|,|，)\s*/i, '').trim();
  if (withoutName.length < 8) return trimmed;

  const sourceLine = sourceText
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length >= 8 && !line.startsWith(fullName) && (withoutName.startsWith(line) || line.startsWith(withoutName.slice(0, 12))));

  if (sourceLine && withoutName.startsWith(sourceLine)) return sourceLine;
  if (sourceWithoutEmails(sourceText).includes(withoutName.slice(0, 16))) return withoutName;
  return trimmed;
}

function sanitizeSkills(skills: ResumeData['skills'], sourceText: string): ResumeData['skills'] {
  const fallback = /[\u4e00-\u9fff]/.test(sourceText) ? '技能' : 'Skills';
  return skills
    .map(group => ({
      ...group,
      category: !group.category.trim() || /^detected skills$/i.test(group.category.trim()) ? fallback : group.category.trim(),
      items: group.items.map(item => item.trim()).filter(Boolean),
    }))
    .filter(group => group.items.length > 0);
}

function sanitizeProject(project: ResumeProject, sourceText: string): ResumeProject {
  let name = project.name.trim();
  let description = collapseRepeatedPhrase(project.description.trim());
  let bullets = restoreSourceBullets(project.bullets, sourceText);

  const joined = splitJoinedTitle(name);
  if (joined && (!description || sameText(description, joined.lead))) {
    if (!bullets.some(bullet => sameText(bullet, joined.lead))) bullets = [joined.lead, ...bullets];
    if (sameText(description, joined.lead)) description = '';
    name = joined.title;
  }

  if (
    description
    && bullets.some(bullet => sameText(bullet, name))
    && !bullets.some(bullet => sameText(bullet, description))
    && description.length + 8 < name.length
  ) {
    bullets = bullets.filter(bullet => !sameText(bullet, name));
    name = description;
    description = '';
  }

  if (description && (bullets.some(bullet => sameText(bullet, description)) || sameText(description, bullets.join(' ')))) {
    description = '';
  }

  return {
    ...project,
    name: name || project.name,
    description,
    bullets,
  };
}

function restoreSourceBullets(bullets: string[], sourceText: string): string[] {
  const sourceBullets = sourceText
    .split(/\r?\n/)
    .map(line => line.trim().match(/^(?:[-*•·]|\u2013)\s+(.+)$/)?.[1]?.trim() || '')
    .filter(Boolean);
  const restored = bullets.flatMap(bullet => splitMergedBullet(collapseRepeatedPhrase(bullet.trim()), sourceBullets));
  const seen = new Set<string>();
  return restored.filter(bullet => {
    const key = normalizeKey(bullet);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitMergedBullet(bullet: string, sourceBullets: string[]): string[] {
  const parts = bullet.split(/\s*;\s*/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2 || sourceBullets.length < 2) return bullet ? [bullet] : [];
  const matched = parts.every(part => sourceBullets.some(source => source.includes(part) || part.includes(source.slice(0, Math.min(source.length, 24)))));
  return matched ? parts : [bullet];
}

function splitJoinedTitle(name: string): { title: string; lead: string } | null {
  const index = name.lastIndexOf(', ');
  if (index < 0) return null;
  const lead = name.slice(0, index).trim();
  const title = name.slice(index + 2).trim();
  if (!lead || !title || title.length > 40 || lead.length < title.length + 8) return null;
  return { title, lead };
}

export function collapseRepeatedPhrase(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  if (compact.length < 16) return value.trim();
  const midpoint = Math.floor(compact.length / 2);
  for (let split = midpoint - 8; split <= midpoint + 8; split += 1) {
    if (split < 8 || split >= compact.length - 8) continue;
    const left = compact.slice(0, split).trim();
    const right = compact.slice(split).trim();
    if (left.length >= 8 && left === right) return left;
  }
  return value.trim();
}

function sameText(left: string, right: string): boolean {
  return normalizeKey(left) === normalizeKey(right) && normalizeKey(left).length > 0;
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceWithoutEmails(sourceText: string): string {
  return sourceText.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
}
