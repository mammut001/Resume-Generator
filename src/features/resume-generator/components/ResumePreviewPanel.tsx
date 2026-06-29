import React, { useCallback, useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, Copy, Download, FileDown, FileText, HelpCircle, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TranslationKey } from '@/i18n';
import type { ResumeData } from '@/types/resume';
import { getExportReadiness, type ExportReadinessReport, type ExportReadinessSection } from '../lib/exportReadiness';
import { formatError } from '../lib/formatError';
import { isRenderServiceUnavailable } from '../lib/classifyRenderError';
import { renderTypst } from '../lib/typstRenderer';
import { useResumeExport } from '../hooks/useResumeExport';
import { sanitizeSvgHtml } from '../lib/sanitizeSvgHtml';
import { useRenderGeneration } from '../hooks/useRenderGeneration';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const toolbarButtonClass = 'app-ghost-btn shrink-0';
const primaryButtonClass = 'app-primary-btn shrink-0';
const previewWidthPx = 8.5 * 96;
const previewHeightPx = 11 * 96;
const previewRailBreakpointPx = 1040;
const previewRailWidthBudgetPx = 260;

export function ResumePreviewPanel({ onOpenCoachMarks }: { onOpenCoachMarks?: () => void }) {
  const {
    activeDocumentId,
    resume,
    typstSource,
    svgHtml,
    setSvgHtml,
    renderStatus,
    setRenderStatus,
    renderError,
  } = useResumeGeneratorStore();
  const { t } = useI18n();
  const { nextGeneration, isCurrentGeneration, invalidate } = useRenderGeneration();

  const workspaceRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasManualZoomRef = useRef(false);
  const [zoom, setZoom] = React.useState(100);
  const readiness = getExportReadiness(resume);
  const serviceUnavailable = isRenderServiceUnavailable(renderError);
  const {
    documentTitle,
    handleCopyTypst,
    handleDownloadTypst,
    handleDownloadPdf,
  } = useResumeExport({
    variant: 'toolbar',
    issueCodes: readiness.issues.map(issue => issue.code),
  });

  const triggerRender = useCallback(async () => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    renderTimeoutRef.current = setTimeout(async () => {
      const generation = nextGeneration();
      setRenderStatus('rendering');
      try {
        const result = await renderTypst(typstSource);
        if (!isCurrentGeneration(generation)) return;

        if (result.ok) {
          setSvgHtml(result.svgHtml ? sanitizeSvgHtml(result.svgHtml) : null);
          setRenderStatus('success');
        } else {
          setSvgHtml(null);
          setRenderStatus('error', result.error || t('preview.renderFailed'));
        }
      } catch (err) {
        if (!isCurrentGeneration(generation)) return;
        setSvgHtml(null);
        setRenderStatus('error', formatError(err, t));
      }
    }, 600);
  }, [isCurrentGeneration, nextGeneration, setRenderStatus, setSvgHtml, t, typstSource]);

  useEffect(() => {
    invalidate();
  }, [activeDocumentId, invalidate]);

  useEffect(() => {
    triggerRender();
    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [triggerRender]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;

    const updateAutoZoom = () => {
      if (hasManualZoomRef.current) return;

      const railBudget = workspace.clientWidth >= previewRailBreakpointPx ? previewRailWidthBudgetPx : 0;
      const availableWidth = workspace.clientWidth - 96 - railBudget;
      const fitZoom = Math.floor((availableWidth / previewWidthPx) * 100);
      const nextZoom = Math.min(100, Math.max(70, Math.floor(fitZoom / 5) * 5));
      setZoom(nextZoom);
    };

    updateAutoZoom();
    const observer = new ResizeObserver(updateAutoZoom);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  const handleZoomIn = () => {
    hasManualZoomRef.current = true;
    setZoom(currentZoom => Math.min(currentZoom + 25, 200));
  };
  const handleZoomOut = () => {
    hasManualZoomRef.current = true;
    setZoom(currentZoom => Math.max(currentZoom - 25, 50));
  };
  const zoomScale = zoom / 100;

  return (
    <div className="hidden min-h-0 min-w-0 flex-1 flex-col bg-[#eef2f6] lg:flex">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-5 py-3 text-slate-900 shadow-sm shadow-slate-200/60">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
            {renderStatus === 'rendering' ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {t('preview.rendering')}
              </>
            ) : renderStatus === 'error' ? (
              <>
                <AlertCircle className="mr-1 h-3 w-3" />
                {serviceUnavailable ? t('preview.renderUnavailableTitle') : t('common.error')}
              </>
            ) : (
              <>
                <span className="mr-1 h-2 w-2 rounded-full bg-green-500" />
                {t('status.ready')}
              </>
            )}
          </Badge>
          {renderError && !serviceUnavailable && (
            <span className="min-w-0 max-w-[360px] truncate text-xs text-rose-600">{renderError}</span>
          )}
          <Badge variant="outline" className="max-w-full rounded border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
            {t('exportPanel.previewDocumentBadge', { title: documentTitle })}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2" data-coach-target="export-actions">
          {onOpenCoachMarks ? (
            <Button
              size="sm"
              variant="outline"
              className={toolbarButtonClass}
              onClick={onOpenCoachMarks}
              aria-label={t('coachMarks.reopen')}
              title={t('coachMarks.reopen')}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className={toolbarButtonClass}
            onClick={handleZoomOut}
            disabled={zoom <= 50}
            aria-label={t('preview.zoomOut')}
            title={t('preview.zoomOut')}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm tabular-nums text-slate-600" aria-live="polite">
            {zoom}%
          </span>
          <Button
            size="sm"
            variant="outline"
            className={toolbarButtonClass}
            onClick={handleZoomIn}
            disabled={zoom >= 200}
            aria-label={t('preview.zoomIn')}
            title={t('preview.zoomIn')}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <Button size="sm" variant="outline" className={toolbarButtonClass} onClick={handleCopyTypst}>
            <Copy className="mr-1 h-4 w-4 shrink-0" />
            {t('common.copy')}
          </Button>
          <Button size="sm" variant="outline" className={toolbarButtonClass} onClick={handleDownloadTypst}>
            <Download className="mr-1 h-4 w-4 shrink-0" />
            {t('actions.downloadTypst')}
          </Button>
          <Button size="sm" className={primaryButtonClass} onClick={handleDownloadPdf}>
            <FileDown className="mr-1 h-4 w-4 shrink-0" />
            {t('common.pdf')}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={workspaceRef} className="flex min-h-full items-start justify-center px-6 py-8">
          <Tabs defaultValue="preview" className="grid w-full max-w-[1080px] grid-cols-1 min-[1600px]:grid-cols-[220px_minmax(0,1fr)] min-[1600px]:items-start min-[1600px]:gap-8">
            <PreviewSideRail resume={resume} readiness={readiness} zoom={zoom} />
            <div className="flex min-w-0 flex-col items-center">
              <TabsList className="app-tab-list self-center">
                <TabsTrigger value="preview" className="app-tab-trigger">
                  {t('tabs.preview')}
                </TabsTrigger>
                <TabsTrigger value="source" className="app-tab-trigger">
                  {t('tabs.source')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="mt-5 flex w-full justify-center">
                <div
                  className="transition-[width,height]"
                  style={{
                    width: previewWidthPx * zoomScale,
                    height: previewHeightPx * zoomScale,
                  }}
                >
                  <div
                    ref={previewRef}
                    className="origin-top-left rounded-sm bg-white shadow-[0_24px_70px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/90 transition-transform"
                    style={{
                      transform: `scale(${zoomScale})`,
                      width: previewWidthPx,
                      minHeight: previewHeightPx,
                    }}
                  >
                    {renderStatus === 'rendering' && (
                      <div className="flex h-full min-h-[400px] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                      </div>
                    )}
                    {renderStatus === 'error' && (
                      <div className="flex h-full min-h-[400px] flex-col items-center justify-center p-8 text-center">
                        <AlertCircle className="mb-4 h-12 w-12 text-rose-500" />
                        <p className="text-lg font-medium text-rose-600">
                          {serviceUnavailable ? t('preview.renderUnavailableTitle') : t('preview.renderingError')}
                        </p>
                        <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                          {serviceUnavailable ? t('preview.renderUnavailableDescription') : renderError}
                        </p>
                        {serviceUnavailable ? (
                          <p className="mt-3 max-w-md text-xs leading-5 text-slate-500">{t('preview.renderUnavailableHint')}</p>
                        ) : null}
                      </div>
                    )}
                    {renderStatus === 'success' && svgHtml && (
                      <div className="typst-preview" dangerouslySetInnerHTML={{ __html: svgHtml }} />
                    )}
                    {renderStatus === 'idle' && (
                      <div className="flex h-full min-h-[400px] items-center justify-center">
                        <p className="text-slate-500">{t('preview.startEditing')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="source" className="mt-5 w-full max-w-[820px]">
                <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700 shadow-sm shadow-slate-200/60">
                  {typstSource}
                </pre>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}

function PreviewSideRail({ resume, readiness, zoom }: { resume: ResumeData; readiness: ExportReadinessReport; zoom: number }) {
  const { t } = useI18n();
  const sections = getPreviewRailSections(resume, readiness);
  const totalBullets = resume.experience.reduce((total, item) => total + item.bullets.length, 0)
    + resume.projects.reduce((total, item) => total + item.bullets.length, 0);
  const totalSkills = resume.skills.reduce((total, group) => total + group.items.length, 0);
  const issueCount = readiness.summary.blockerCount + readiness.summary.warningCount + readiness.summary.suggestionCount;
  const readinessTone = readiness.level === 'ready' ? 'ready' : readiness.level === 'blocked' ? 'blocked' : 'review';
  const pageSizeLabelKey: TranslationKey = resume.design.pageSize === 'a4' ? 'design.pageSize.a4.label' : 'design.pageSize.letter.label';

  return (
    <aside className="hidden w-[220px] space-y-3 pt-[52px] min-[1600px]:block" aria-label={t('previewRail.title')} data-coach-target="preview-rail">
      <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm shadow-slate-200/50 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('previewRail.title')}</p>
          <ClipboardList className="h-4 w-4 text-blue-600" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-2">
          <div>
            <p className="text-lg font-semibold leading-none text-slate-900">{readiness.score}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">{t('previewRail.score')}</p>
          </div>
          <Badge variant="outline" className={getRailBadgeClass(readinessTone)}>
            {readiness.level === 'ready'
              ? t('status.ready')
              : t(issueCount === 1 ? 'previewRail.oneIssue' : 'previewRail.issueCount', { count: issueCount })}
          </Badge>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm shadow-slate-200/50 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-900">{t('previewRail.sections')}</p>
          <FileText className="h-4 w-4 text-slate-500" />
        </div>
        <div className="mt-2 space-y-1.5">
          {sections.map(section => (
            <div key={section.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
              {section.tone === 'ready' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className={section.tone === 'blocked' ? 'h-3.5 w-3.5 shrink-0 text-rose-600' : 'h-3.5 w-3.5 shrink-0 text-amber-600'} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{t(section.labelKey)}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{section.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm shadow-slate-200/50 backdrop-blur">
        <p className="text-xs font-semibold text-slate-900">{t('previewRail.document')}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RailMetric label={t('fields.page')} value={t(pageSizeLabelKey)} />
          <RailMetric label={t('previewRail.zoom')} value={`${zoom}%`} />
          <RailMetric label={t('fields.bullets')} value={totalBullets} />
          <RailMetric label={t('fields.skills')} value={totalSkills} />
        </div>
      </section>
    </aside>
  );
}

function RailMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function getPreviewRailSections(resume: ResumeData, readiness: ExportReadinessReport) {
  const skillCount = resume.skills.reduce((total, group) => total + group.items.length, 0);
  const sections: Array<{ id: ExportReadinessSection; labelKey: TranslationKey; value: number | string }> = [
    { id: 'personal', labelKey: 'exportReadiness.sections.personal', value: countFilledValues([
      resume.personal.fullName,
      resume.personal.headline,
      resume.personal.email,
      resume.personal.phone,
      resume.personal.location,
    ]) },
    { id: 'summary', labelKey: 'exportReadiness.sections.summary', value: resume.summary.trim().length },
    { id: 'experience', labelKey: 'exportReadiness.sections.experience', value: resume.experience.length },
    { id: 'education', labelKey: 'exportReadiness.sections.education', value: resume.education.length },
    { id: 'skills', labelKey: 'exportReadiness.sections.skills', value: skillCount },
    { id: 'projects', labelKey: 'exportReadiness.sections.projects', value: resume.projects.length },
  ];

  return sections.map(section => ({
    ...section,
    tone: getSectionTone(readiness, section.id),
  }));
}

function countFilledValues(values: Array<string | undefined | null>): number {
  return values.filter(value => (value || '').trim().length > 0).length;
}

function getSectionTone(readiness: ExportReadinessReport, section: ExportReadinessSection): 'ready' | 'review' | 'blocked' {
  const issues = readiness.issues.filter(issue => issue.section === section);
  if (issues.some(issue => issue.severity === 'blocker')) return 'blocked';
  if (issues.length > 0) return 'review';
  return 'ready';
}

function getRailBadgeClass(tone: 'ready' | 'review' | 'blocked'): string {
  if (tone === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'blocked') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}
