import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { translate } from '@/i18n';
import { renderResumeToTypst, resumeTemplates } from '@/features/resume-generator/data/resumeTemplates';
import { defaultResume, getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { applyTailoringChanges } from '@/features/resume-generator/lib/applyTailoringChanges';
import { loadResumeVersions, saveResumeVersion, deleteResumeVersion, clearResumeVersions } from '@/features/resume-generator/lib/resumeHistory';
import { formatError } from '@/features/resume-generator/lib/formatError';
import { ResumeTailoringResult, ResumeVersion } from '@/types/resume';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('resumeToTypst', () => {
  it('generates stable Typst output', () => {
    const result1 = renderResumeToTypst(defaultResume, 'clean-professional');
    const result2 = renderResumeToTypst(defaultResume, 'clean-professional');
    expect(result1).toBe(result2);
  });

  it('escapes unsafe characters in user content', () => {
    const resumeWithSpecialChars = {
      ...defaultResume,
      personal: {
        ...defaultResume.personal,
        fullName: 'John "Jack" O\'Brien',
        headline: 'Engineer & Designer',
      },
      summary: 'Testing *bold* and _italic_ and #hashtags',
    };
    const result = renderResumeToTypst(resumeWithSpecialChars, 'clean-professional');
    // Should contain escaped characters
    expect(result).toContain('\\"');
    expect(result).not.toContain('[object Object]');
  });

  it('includes key resume sections', () => {
    const result = renderResumeToTypst(defaultResume, 'clean-professional');
    expect(result).toContain('Experience');
    expect(result).toContain('Education');
    expect(result).toContain('Skills');
    expect(result).toContain('Projects');
    expect(result).toContain('Summary');
  });

  it('works with all visible templates', () => {
    for (const template of resumeTemplates) {
      const result = renderResumeToTypst(defaultResume, template.id);
      expect(result.length).toBeGreaterThan(100);
      expect(result).toContain('Experience');
    }
  });

  it('generates distinct Typst output for different templates', () => {
    const classic = renderResumeToTypst(defaultResume, 'clean-professional');
    const modern = renderResumeToTypst(defaultResume, 'modern-compact');

    expect(classic).not.toBe(modern);
  });

  it('defines preview metadata for every template card', () => {
    for (const template of resumeTemplates) {
      expect(translate('en', template.nameKey).length).toBeGreaterThan(0);
      expect(translate('en', template.preview.layoutLabelKey).length).toBeGreaterThan(0);
      expect(template.preview.tagKeys.length).toBeGreaterThan(0);
      expect(template.preview.imagePath).toMatch(/^\/template-previews\/.+\.svg(?:\?v=[\w-]+)?$/);
    }
  });

  it('localizes fixed typst section headings', () => {
    const result = renderResumeToTypst(defaultResume, 'clean-professional', 'zh-CN');

    expect(result).toContain('== 工作经历');
    expect(result).toContain('== 教育经历');
    expect(result).toContain('== 项目');
  });

  it('localizes the Projects section header in every template', () => {
    const zhResume = getDefaultResume('zh-CN');
    const enBasic = renderResumeToTypst(defaultResume, 'clean-professional', 'en');
    const zhBasic = renderResumeToTypst(zhResume, 'clean-professional', 'zh-CN');
    const zhRenderCv = renderResumeToTypst(zhResume, 'rendercv', 'zh-CN');
    const zhBrilliant = renderResumeToTypst(zhResume, 'brilliant-cv', 'zh-CN');

    expect(enBasic).toContain('== Projects');
    expect(zhBasic).toContain('== 项目');
    expect(zhRenderCv).toContain('== 项目');
    expect(zhBrilliant).toContain('cv-section("项目")');
  });

  it('adds Chinese language hints for Chinese Typst output', () => {
    const zhResume = getDefaultResume('zh-CN');
    const basic = renderResumeToTypst(zhResume, 'clean-professional', 'zh-CN');
    const renderCv = renderResumeToTypst(zhResume, 'rendercv', 'zh-CN');
    const brilliant = renderResumeToTypst(zhResume, 'brilliant-cv', 'zh-CN');

    expect(basic).toContain('#set text(lang: "zh")');
    expect(renderCv).toContain('#set text(lang: "zh")');
    expect(brilliant).toContain('#set text(lang: "zh")');
  });

  it('does not render a visible escape slash in email links', () => {
    const result = renderResumeToTypst(defaultResume, 'rendercv');

    expect(result).toContain('alex.chen@email.com');
    expect(result).not.toContain('alex.chen\\@email.com');
    expect(result).not.toContain('\\@email.com');
  });

  it('applies design settings to Typst output', () => {
    const result = renderResumeToTypst(
      {
        ...defaultResume,
        design: {
          ...defaultResume.design,
          accentColor: '#0f766e',
          density: 'compact',
          pageSize: 'a4',
          typography: 'sans',
        },
      },
      'clean-professional',
    );

    expect(result).toContain('accent-color: "#0f766e"');
    expect(result).toContain('paper: "a4"');
  });

  it('updates templateId when the template selection changes', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');

    useResumeGeneratorStore.setState({
      ...useResumeGeneratorStore.getState(),
      resume: JSON.parse(JSON.stringify(defaultResume)),
      typstSource: renderResumeToTypst(defaultResume, defaultResume.templateId),
      versions: [],
      renderStatus: 'idle',
      renderError: null,
      svgHtml: null,
    });

    const initialSource = useResumeGeneratorStore.getState().typstSource;
    useResumeGeneratorStore.getState().setTemplate('modern-compact');
    const nextState = useResumeGeneratorStore.getState();

    expect(nextState.resume.templateId).toBe('modern-compact');
    expect(nextState.typstSource).not.toBe(initialSource);
  });

  it('loads a localized default resume for Chinese users on first initialization', async () => {
    localStorage.clear();
    localStorage.setItem('resume-generator-locale', 'zh-CN');
    vi.resetModules();

    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');

    expect(useResumeGeneratorStore.getState().resume.title).toBe(getDefaultResume('zh-CN').title);
  });
});

describe('resumeHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saves and loads versions', () => {
    const version: ResumeVersion = {
      id: 'test-version-1',
      createdAt: new Date().toISOString(),
      label: 'Test version',
      resume: JSON.parse(JSON.stringify(defaultResume)),
      typstSource: '#import "@preview/cetz:0.3.1"',
    };

    saveResumeVersion(version);
    const versions = loadResumeVersions();

    expect(versions.length).toBe(1);
    expect(versions[0].id).toBe('test-version-1');
    expect(versions[0].label).toBe('Test version');
  });

  it('deletes versions correctly', () => {
    const version: ResumeVersion = {
      id: 'test-version-to-delete',
      createdAt: new Date().toISOString(),
      label: 'To delete',
      resume: JSON.parse(JSON.stringify(defaultResume)),
      typstSource: '',
    };

    saveResumeVersion(version);
    deleteResumeVersion('test-version-to-delete');

    const versions = loadResumeVersions();
    expect(versions.find(v => v.id === 'test-version-to-delete')).toBeUndefined();
  });

  it('handles corrupt storage gracefully', () => {
    localStorage.setItem('resume-generator-versions', 'not valid json');
    const versions = loadResumeVersions();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBe(0);
  });

  it('clears all versions', () => {
    const version: ResumeVersion = {
      id: 'test-version-clear',
      createdAt: new Date().toISOString(),
      label: 'To clear',
      resume: JSON.parse(JSON.stringify(defaultResume)),
      typstSource: '',
    };

    saveResumeVersion(version);
    clearResumeVersions();

    const versions = loadResumeVersions();
    expect(versions.length).toBe(0);
  });
});

describe('formatError', () => {
  it('formats Error objects', () => {
    const error = new Error('Test error message');
    expect(formatError(error)).toBe('Test error message');
  });

  it('formats strings', () => {
    expect(formatError('Simple string error')).toBe('Simple string error');
  });

  it('formats objects', () => {
    expect(formatError({ code: 'TEST', message: 'Test' })).toBe('{"code":"TEST","message":"Test"}');
  });

  it('handles circular objects', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const result = formatError(circular);
    // Circular objects throw during JSON.stringify, so we get "Unknown error"
    expect(result).toBe('Unknown error');
  });

  it('handles unknown errors', () => {
    expect(formatError(null)).toBe('Unknown error');
    expect(formatError(undefined)).toBe('Unknown error');

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    const t = (key: string) => {
      if (key === 'errors.unknown') return '未知错误';
      throw new Error(`Unexpected key ${key}`);
    };
    expect(formatError(null, t)).toBe('未知错误');
    expect(formatError(undefined, t)).toBe('未知错误');
    expect(formatError(circular, t)).toBe('未知错误');
  });
});

describe('applyTailoringChanges', () => {
  const cloneDefaultResume = () => JSON.parse(JSON.stringify(defaultResume)) as typeof defaultResume;

  function buildResult(tailoredResume = cloneDefaultResume(), changes: ResumeTailoringResult['changes']): ResumeTailoringResult {
    return {
      tailoredResume,
      summary: {
        targetRole: 'Frontend Platform Engineer',
        keyRequirements: [],
        matchedStrengths: [],
        gaps: [],
      },
      changes,
      warnings: [],
    };
  }

  it('applies an accepted summary rewrite while preserving contact, design, and template', () => {
    const source = cloneDefaultResume();
    const tailored = cloneDefaultResume();
    tailored.id = 'tailored-resume';
    tailored.title = 'Tailored Frontend Resume';
    tailored.summary = 'Frontend platform engineer focused on React, TypeScript, accessibility, and design systems.';
    tailored.personal.email = 'changed@example.com';
    tailored.templateId = 'modern-compact';
    tailored.design = { ...tailored.design, accentColor: '#0f766e' };

    const selected = applyTailoringChanges(source, buildResult(tailored, [{
      id: 'change-summary',
      section: 'summary',
      kind: 'rewritten',
      description: 'Rewrite summary.',
      targetPath: 'summary',
      before: source.summary,
      after: tailored.summary,
    }]), ['change-summary']);

    expect(selected.summary).toBe(tailored.summary);
    expect(selected.personal).toEqual(source.personal);
    expect(selected.templateId).toBe(source.templateId);
    expect(selected.design).toEqual(source.design);
    expect(source.summary).toBe(defaultResume.summary);
  });

  it('applies a skills reorder only when its change is accepted', () => {
    const source = cloneDefaultResume();
    const tailored = cloneDefaultResume();
    tailored.skills = source.skills.map(group => ({ ...group, items: [...group.items].reverse() }));
    const result = buildResult(tailored, [{
      id: 'change-skills',
      section: 'skills',
      kind: 'reordered',
      description: 'Reorder skills.',
      targetPath: 'skills',
      before: source.skills.flatMap(group => group.items).join(', '),
      after: tailored.skills.flatMap(group => group.items).join(', '),
    }]);

    expect(applyTailoringChanges(source, result, []).skills).toEqual(source.skills);
    expect(applyTailoringChanges(source, result, ['change-skills']).skills).toEqual(tailored.skills);
  });

  it('applies one accepted experience bullet change without applying rejected changes', () => {
    const source = cloneDefaultResume();
    const tailored = cloneDefaultResume();
    tailored.summary = 'Rejected summary should not be applied.';
    tailored.experience[0].bullets[1] = 'Mentored 4 junior engineers on platform onboarding and code review practices.';
    const result = buildResult(tailored, [
      {
        id: 'change-summary',
        section: 'summary',
        kind: 'rewritten',
        description: 'Rewrite summary.',
        targetPath: 'summary',
        before: source.summary,
        after: tailored.summary,
      },
      {
        id: 'change-bullet',
        section: 'experience',
        kind: 'rewritten',
        description: 'Rewrite one bullet.',
        targetPath: 'experience.0.bullets.1',
        before: source.experience[0].bullets[1],
        after: tailored.experience[0].bullets[1],
      },
    ]);

    const selected = applyTailoringChanges(source, result, ['change-bullet']);

    expect(selected.summary).toBe(source.summary);
    expect(selected.experience[0].bullets[1]).toBe(tailored.experience[0].bullets[1]);
    expect(selected.experience[0].bullets[0]).toBe(source.experience[0].bullets[0]);
  });

  it('returns the original resume data when zero changes are accepted', () => {
    const source = cloneDefaultResume();
    const tailored = cloneDefaultResume();
    tailored.summary = 'Accepted changes are required.';

    const selected = applyTailoringChanges(source, buildResult(tailored, [{
      id: 'change-summary',
      section: 'summary',
      kind: 'rewritten',
      description: 'Rewrite summary.',
      targetPath: 'summary',
      before: source.summary,
      after: tailored.summary,
    }]), []);

    expect(selected).toEqual(source);
    expect(selected).not.toBe(source);
  });

  it('ignores malformed target paths when the change cannot be matched safely', () => {
    const source = cloneDefaultResume();
    const tailored = cloneDefaultResume();
    tailored.experience[0].bullets[0] = 'This should not apply through a malformed path.';

    const selected = applyTailoringChanges(source, buildResult(tailored, [{
      id: 'bad-path',
      section: 'experience',
      kind: 'rewritten',
      description: 'Bad path.',
      targetPath: 'experience.99.bullets.0',
      before: 'not present in the source resume',
      after: tailored.experience[0].bullets[0],
    }]), ['bad-path']);

    expect(selected.experience).toEqual(source.experience);
  });
});
