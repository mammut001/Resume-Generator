// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('locale switch replaces the starter resume sample', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');
    useResumeGeneratorStore.setState({
      ...useResumeGeneratorStore.getState(),
      resume: getDefaultResume('en'),
      typstSource: '',
      renderStatus: 'idle',
    });
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    useLocaleStore.getState().setLocale('en');
  });

  it('replaces an untouched starter sample when the user switches language', () => {
    const enStarter = useResumeGeneratorStore.getState().resume;
    expect(enStarter.personal.fullName).toBe('Alex Chen');

    useLocaleStore.getState().setLocale('zh-CN');

    const next = useResumeGeneratorStore.getState().resume;
    expect(next.personal.fullName).not.toBe('Alex Chen');
    expect(next.personal.fullName).toBe(getDefaultResume('zh-CN').personal.fullName);
    expect(next.title).toBe(getDefaultResume('zh-CN').title);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      '已切换为新语言的示例内容',
      expect.objectContaining({ description: '已用本地化示例替换原简历，让你立刻看到真实翻译效果。' }),
    );
  });

  it('preserves user-edited resumes and offers a one-click sample swap', () => {
    const enStarter = useResumeGeneratorStore.getState().resume;
    const customized = {
      ...enStarter,
      personal: { ...enStarter.personal, fullName: 'Custom User Name' },
    };
    useResumeGeneratorStore.setState({ ...useResumeGeneratorStore.getState(), resume: customized });

    useLocaleStore.getState().setLocale('zh-CN');

    const after = useResumeGeneratorStore.getState().resume;
    expect(after.personal.fullName).toBe('Custom User Name');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledTimes(1);
    const infoArgs = (toast.info as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = infoArgs[1] as { action: { label: string; onClick: () => void } };
    expect(typeof options.action.label).toBe('string');
    expect(options.action.label.length).toBeGreaterThan(0);
    options.action.onClick();
    const replaced = useResumeGeneratorStore.getState().resume;
    expect(replaced.personal.fullName).toBe(getDefaultResume('zh-CN').personal.fullName);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
