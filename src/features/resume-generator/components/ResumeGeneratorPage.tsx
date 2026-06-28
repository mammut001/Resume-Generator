import { useEffect } from 'react';
import { useLocaleStore } from '@/i18n';
import { useI18n } from '@/i18n/useI18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { ResumeEditorPanel } from './ResumeEditorPanel';
import { ResumePreviewPanel } from './ResumePreviewPanel';
import { ToasterComponent } from '@/components/ui/toast';

export function ResumeGeneratorPage() {
  const { t } = useI18n();

  useEffect(() => {
    trackAnalyticsEvent('page_viewed', {
      path: typeof window !== 'undefined' ? window.location.pathname : '/',
      locale: useLocaleStore.getState().locale,
    });
  }, []);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-slate-100/80 lg:flex-row">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ResumeEditorPanel />
      </main>
      <aside aria-label={t('a11y.previewPanel')} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ResumePreviewPanel />
      </aside>
      <ToasterComponent />
    </div>
  );
}