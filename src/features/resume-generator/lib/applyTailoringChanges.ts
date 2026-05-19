import type { ResumeData, ResumeTailoringChange, ResumeTailoringResult } from '@/types/resume';

export function applyTailoringChanges(sourceResume: ResumeData, result: ResumeTailoringResult, acceptedChangeIds: Iterable<string>): ResumeData {
  const acceptedIds = new Set(acceptedChangeIds);
  const draft = cloneResume(sourceResume);

  if (acceptedIds.size === 0) return draft;

  draft.id = result.tailoredResume.id || draft.id;
  draft.title = result.tailoredResume.title || draft.title;

  for (const change of result.changes) {
    if (!acceptedIds.has(change.id)) continue;
    applyChange(draft, sourceResume, result.tailoredResume, change);
  }

  draft.templateId = sourceResume.templateId;
  draft.design = cloneResume(sourceResume).design;
  draft.personal = cloneResume(sourceResume).personal;
  return draft;
}

function applyChange(draft: ResumeData, sourceResume: ResumeData, tailoredResume: ResumeData, change: ResumeTailoringChange): boolean {
  if (change.targetPath && applyChangeByTargetPath(draft, sourceResume, tailoredResume, change)) return true;

  if (change.section === 'summary') {
    return applySummaryChange(draft, sourceResume, tailoredResume, change);
  }

  if (change.section === 'skills') {
    draft.skills = cloneResume(tailoredResume).skills;
    return true;
  }

  if (change.section === 'experience') {
    return applyBulletTextChange(draft.experience.map(entry => entry.bullets), change);
  }

  if (change.section === 'projects') {
    return applyBulletTextChange(draft.projects.map(project => project.bullets), change)
      || applyProjectDescriptionTextChange(draft, change);
  }

  return false;
}

function applyChangeByTargetPath(draft: ResumeData, sourceResume: ResumeData, tailoredResume: ResumeData, change: ResumeTailoringChange): boolean {
  const parts = change.targetPath?.split('.') || [];
  if (parts.length === 0) return false;

  if (change.targetPath === 'summary') return applySummaryChange(draft, sourceResume, tailoredResume, change);
  if (change.targetPath === 'skills') {
    draft.skills = cloneResume(tailoredResume).skills;
    return true;
  }

  if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'items') {
    const groupIndex = parseIndex(parts[1]);
    if (groupIndex === null || !draft.skills[groupIndex] || !tailoredResume.skills[groupIndex]) return false;
    draft.skills[groupIndex] = { ...draft.skills[groupIndex], items: [...tailoredResume.skills[groupIndex].items] };
    return true;
  }

  if ((parts[0] === 'experience' || parts[0] === 'projects') && parts.length >= 3) {
    return applyEntryTargetPath(draft, sourceResume, tailoredResume, change, parts as [string, string, string, ...string[]]);
  }

  return false;
}

function applyEntryTargetPath(draft: ResumeData, sourceResume: ResumeData, tailoredResume: ResumeData, change: ResumeTailoringChange, parts: [string, string, string, ...string[]]): boolean {
  const section = parts[0];
  const entryIndex = parseIndex(parts[1]);
  const field = parts[2];
  if (entryIndex === null) return false;

  if (section === 'experience' && field === 'bullets') {
    const draftEntry = draft.experience[entryIndex];
    const sourceEntry = sourceResume.experience[entryIndex];
    const tailoredEntry = tailoredResume.experience[entryIndex];
    if (!draftEntry || !sourceEntry || !tailoredEntry) return false;
    return applyBulletsAtPath(draftEntry.bullets, sourceEntry.bullets, tailoredEntry.bullets, change, parts[3]);
  }

  if (section === 'projects') {
    const draftProject = draft.projects[entryIndex];
    const sourceProject = sourceResume.projects[entryIndex];
    const tailoredProject = tailoredResume.projects[entryIndex];
    if (!draftProject || !sourceProject || !tailoredProject) return false;

    if (field === 'description') {
      if (change.before && sourceProject.description !== change.before) return false;
      draftProject.description = change.after || tailoredProject.description;
      return true;
    }

    if (field === 'bullets') return applyBulletsAtPath(draftProject.bullets, sourceProject.bullets, tailoredProject.bullets, change, parts[3]);
  }

  return false;
}

function applySummaryChange(draft: ResumeData, sourceResume: ResumeData, tailoredResume: ResumeData, change: ResumeTailoringChange): boolean {
  if (change.before && sourceResume.summary !== change.before) return false;
  draft.summary = change.after || tailoredResume.summary;
  return true;
}

function applyBulletsAtPath(draftBullets: string[], sourceBullets: string[], tailoredBullets: string[], change: ResumeTailoringChange, bulletIndexPart?: string): boolean {
  if (!bulletIndexPart) {
    if (change.before && sourceBullets.join('\n') !== change.before) return false;
    draftBullets.splice(0, draftBullets.length, ...(change.after ? splitBulletBlock(change.after) : [...tailoredBullets]));
    return true;
  }

  const bulletIndex = parseIndex(bulletIndexPart);
  if (bulletIndex === null || !draftBullets[bulletIndex] || !sourceBullets[bulletIndex]) return false;
  if (change.before && sourceBullets[bulletIndex] !== change.before) return false;
  draftBullets[bulletIndex] = change.after || tailoredBullets[bulletIndex] || draftBullets[bulletIndex];
  return true;
}

function applyBulletTextChange(bulletGroups: string[][], change: ResumeTailoringChange): boolean {
  if (!change.before || !change.after) return false;

  for (const bullets of bulletGroups) {
    const bulletIndex = bullets.findIndex(bullet => bullet === change.before);
    if (bulletIndex >= 0) {
      bullets[bulletIndex] = change.after;
      return true;
    }

    if (bullets.join('\n') === change.before) {
      bullets.splice(0, bullets.length, ...splitBulletBlock(change.after));
      return true;
    }
  }

  return false;
}

function applyProjectDescriptionTextChange(draft: ResumeData, change: ResumeTailoringChange): boolean {
  if (!change.before || !change.after) return false;

  const project = draft.projects.find(candidate => candidate.description === change.before);
  if (!project) return false;
  project.description = change.after;
  return true;
}

function splitBulletBlock(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean);
}

function parseIndex(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function cloneResume(resume: ResumeData): ResumeData {
  return JSON.parse(JSON.stringify(resume)) as ResumeData;
}