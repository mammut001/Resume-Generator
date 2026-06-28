import React, { useCallback, useEffect, useRef } from 'react';
import { AlertCircle, Copy, Download, FileDown, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getExportReadiness } from '../lib/exportReadiness';
import { formatError } from '../lib/formatError';
import { isRenderServiceUnavailable } from '../lib/classifyRenderError';
import { renderTypst } from '../lib/typstRenderer';
import { useResumeExport } from '../hooks/useResumeExport';
import { sanitizeSvgHtml } from '../lib/sanitizeSvgHtml';
import { useRenderGeneration } from '../hooks/useRenderGeneration';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const toolbarButtonClass = 'app-ghost-btn shrink-0';
const primaryButtonClass = 'app-primary-btn shrink-0';

export function ResumePreviewPanel() {
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

  const previewRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [zoom, setZoom] = React.useState(75);
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

  const handleZoomIn = () => setZoom(currentZoom => Math.min(currentZoom + 25, 200));
  const handleZoomOut = () => setZoom(currentZoom => Math.max(currentZoom - 25, 50));

  return (
    <div className="hidden min-h-0 min-w-0 flex-1 flex-col bg-slate-50/70 lg:flex">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3 text-slate-900">
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
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
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
        <div className="flex min-h-full items-start justify-center p-4 sm:p-8">
          <Tabs defaultValue="preview" className="w-full max-w-[800px]">
            <TabsList className="app-tab-list w-full justify-start">
              <TabsTrigger value="preview" className="app-tab-trigger">
                {t('tabs.preview')}
              </TabsTrigger>
              <TabsTrigger value="source" className="app-tab-trigger">
                {t('tabs.source')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="mt-4">
              <div
                ref={previewRef}
                className="origin-top rounded-sm bg-white shadow-md ring-1 ring-slate-200/80 transition-transform"
                style={{
                  transform: `scale(${zoom / 100})`,
                  minWidth: '8.5in',
                  minHeight: '11in',
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
            </TabsContent>
            <TabsContent value="source" className="mt-4">
              <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700">
                {typstSource}
              </pre>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}