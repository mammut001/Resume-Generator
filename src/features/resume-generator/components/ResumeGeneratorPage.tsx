import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n/useI18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { ResumeEditorPanel } from './ResumeEditorPanel';
import { ResumePreviewPanel } from './ResumePreviewPanel';
import { ToasterComponent } from '@/components/ui/toast';

export function ResumeGeneratorPage() {
  const { locale } = useI18n();
  const hasTrackedPageView = useRef(false);

  useEffect(() => {
    if (hasTrackedPageView.current) return;
    hasTrackedPageView.current = true;
    trackAnalyticsEvent('page_viewed', {
      path: typeof window !== 'undefined' ? window.location.pathname : '/',
      locale,
    });
  }, [locale]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 lg:flex-row">
      <ResumeEditorPanel />
      <ResumePreviewPanel />
      <ToasterComponent />
    </div>
  );
}