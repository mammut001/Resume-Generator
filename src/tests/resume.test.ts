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
    const poison = 'dev@ex.com #tag $math *bold* _em_ <lab> [br] \\slash `tick`';
    const resumeWithSpecialChars = {
      ...defaultResume,
      personal: {
        ...defaultResume.personal,
        fullName: 'John "Jack" O\'Brien',
        headline: poison,
        email: 'dev@ex.com',
      },
      summary: poison,
      experience: [{
        ...defaultResume.experience[0],
        role: poison,
        company: 'Acme @HQ',
        bullets: [poison],
      }],
      skills: [{ id: 'skill-poison', category: 'Tools', items: [poison] }],
      projects: [{
        id: 'proj-poison',
        name: 'Kit',
        description: poison,
        url: '',
        bullets: [poison],
      }],
    };

    for (const template of resumeTemplates) {
      const result = renderResumeToTypst(resumeWithSpecialChars, template.id);
      expect(result, template.id).toContain('\\@');
      expect(result, template.id).toContain('\\#');
      expect(result, template.id).toContain('\\$');
      expect(result, template.id).toContain('\\*');
      expect(result, template.id).toContain('\\_');
      expect(result, template.id).toContain('\\<');
      expect(result, template.id).toContain('\\>');
      expect(result, template.id).toContain('\\[');
      expect(result, template.id).toContain('\\]');
      expect(result, template.id).toContain('\\\\');
      expect(result, template.id).toContain('"dev@ex.com"');
      expect(result, template.id).not.toContain('"dev\\@ex.com"');
      expect(result, template.id).not.toContain('mailto:dev\\@ex.com');
    }
    expect(renderResumeToTypst(resumeWithSpecialChars, 'clean-professional')).toContain('\\"');
  });

  it('includes key resume sections', () => {
    const result = renderResumeToTypst(defaultResume, 'clean-professional');
    expect(result).toContain('Experience');
    expect(result).toContain('Education');
    expect(result).toContain('Skills');
    expect(result).toContain('Projects');
    expect(result).toContain('Summary');
  });

  it('renders project titles before distinct descriptions and does not repeat a bullet', () => {
    const resume = {
      ...defaultResume,
      projects: [
        {
          id: 'proj-zh',
          name: '校园二手交易小程序运营',
          description: '负责冷启动增长，3 个月注册用户破 5000',
          bullets: ['负责冷启动增长，3 个月注册用户破 5000'],
        },
        defaultResume.projects[0],
      ],
    };

    const result = renderResumeToTypst(resume, 'clean-professional', 'zh-CN');

    expect(result).toContain('校园二手交易小程序运营');
    expect(result).not.toContain('负责冷启动增长，3 个月注册用户破 5000, 校园二手交易小程序运营');
    expect(result.split('负责冷启动增长，3 个月注册用户破 5000').length - 1).toBe(1);
    expect(result).toContain('OpenSource UI Kit');
    expect(result).toContain('A customizable, accessible React component library');
    expect(result).toContain('role: ""');
  });

  it('works with all visible templates', () => {
    for (const template of resumeTemplates) {
      const result = renderResumeToTypst(defaultResume, template.id);
      expect(result.length).toBeGreaterThan(100);
      expect(result).toContain('Experience');
    }
  });

  it('keeps summary text and job bullets as separate list items in every public template', () => {
    const templateIds = ['basic-resume', 'clean-professional', 'brilliant-cv', 'rendercv', 'modern-compact'];
    const markers = [
      'Led frontend architecture',
      'Mentored 4 junior engineers',
      'Built a reusable component library',
    ];

    for (const templateId of templateIds) {
      const source = renderResumeToTypst(defaultResume, templateId, 'en');
      const resolved = templateId === 'clean-professional' ? 'basic-resume' : templateId === 'modern-compact' ? 'rendercv' : templateId;
      expect(source, templateId).toContain('Summary');
      expect(source, templateId).toContain('Experience');
      expect(source, templateId).toContain('Education');
      expect(source, templateId).toContain('Skills');
      expect(source, templateId).toContain('Projects');
      expect(source, templateId).toContain(defaultResume.summary.slice(0, 24));
      expect(source, templateId).not.toContain(`${markers[0]} • ${markers[1]}`);
      expect(source, templateId).not.toContain(`• ${markers[0]} • ${markers[1]}`);

      if (resolved === 'brilliant-cv') {
        expect(source, templateId).toContain('description: list(');
        expect(source, templateId).not.toMatch(/#cv-section\("Summary"\)\n\[/);
        for (const marker of markers) {
          expect(source, templateId).toContain(`[${marker}`);
        }
        expect(source.match(/description: list\(/g)?.length).toBeGreaterThanOrEqual(defaultResume.experience.length);
      } else {
        for (const marker of markers) {
          expect(source, templateId).toContain(`- ${marker}`);
        }
      }
    }

    expect(renderResumeToTypst(defaultResume, 'clean-professional')).toBe(renderResumeToTypst(defaultResume, 'basic-resume'));
    expect(renderResumeToTypst(defaultResume, 'modern-compact')).toBe(renderResumeToTypst(defaultResume, 'rendercv'));
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

  it('translates library-thrown errors via TranslationError', async () => {
    const { exportPdf, copyTypstSource } = await import('@/features/resume-generator/lib/exportResume');
    const { formatError, TranslationError } = await import('@/features/resume-generator/lib/formatError');
    const { translate } = await import('@/i18n');

    const t = (key: string) => translate('zh-CN', key as never);

    await expect(exportPdf({} as never, undefined)).rejects.toBeInstanceOf(TranslationError);
    await expect(copyTypstSource('')).rejects.toBeInstanceOf(TranslationError);

    await expect(exportPdf({} as never, undefined)).rejects.toMatchObject({ key: 'errors.noPdfToExport' });

    const translated = formatError(new TranslationError('errors.copyToClipboardFailed'), t);
    expect(translated).toBe('复制到剪贴板失败');

    // Fallback: without a t function, formatError returns the key.
    expect(formatError(new TranslationError('errors.copyToClipboardFailed'))).toBe('errors.copyToClipboardFailed');
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

  it('prints the headline, hides a repeated skill label, and uses Chinese page and skill punctuation', () => {
    const zhResume = getDefaultResume('zh-CN');
    const enBasic = renderResumeToTypst(defaultResume, 'clean-professional', 'en');
    const zhBasic = renderResumeToTypst(zhResume, 'clean-professional', 'zh-CN');
    const flatEnglish = renderResumeToTypst({
      ...defaultResume,
      skills: [{ id: 'skill-1', category: 'Skills', items: ['TypeScript', 'React'] }],
    }, 'clean-professional', 'en');
    const flatChinese = renderResumeToTypst({
      ...zhResume,
      skills: [{ id: 'skill-1', category: '技能', items: ['TypeScript', 'React'] }],
    }, 'clean-professional', 'zh-CN');

    expect(enBasic).toContain('#text(style: "italic")[Product-Minded Frontend Engineer]');
    expect(zhBasic).toContain('#text(style: "italic")[注重产品体验的前端工程师]');
    expect(zhResume.design.pageSize).toBe('a4');
    expect(zhBasic).toContain('paper: "a4"');
    expect(enBasic).toContain('paper: "us-letter"');
    expect(zhBasic).toContain('TypeScript、JavaScript');
    expect(flatEnglish).not.toContain('*Skills:*');
    expect(flatEnglish).toContain('TypeScript, React');
    expect(flatChinese).not.toContain('*技能:*');
    expect(flatChinese).toContain('TypeScript、React');
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
