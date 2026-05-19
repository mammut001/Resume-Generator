import { ResumeVersion } from '@/types/resume';

const STORAGE_KEY = 'resume-generator-versions';

export function loadResumeVersions(): ResumeVersion[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const versions = JSON.parse(stored);
    if (!Array.isArray(versions)) return [];
    return versions;
  } catch {
    return [];
  }
}

export function saveResumeVersion(version: ResumeVersion): void {
  try {
    const versions = loadResumeVersions();
    versions.unshift(version);
    // Keep only last 50 versions
    const trimmed = versions.slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save resume version:', e);
  }
}

export function deleteResumeVersion(id: string): void {
  try {
    const versions = loadResumeVersions();
    const filtered = versions.filter(v => v.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to delete resume version:', e);
  }
}

export function clearResumeVersions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear resume versions:', e);
  }
}