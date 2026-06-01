import React, { useCallback, useEffect, useRef } from 'react';
import { AlertCircle, Copy, Download, FileDown, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/i18n/useI18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';
import { copyTypstSource, downloadTypstSource, exportPdf } from '../lib/exportResume';
import { getExportReadiness } from '../lib/exportReadiness';
import { formatError } from '../lib/formatError';
import { renderTypst, renderTypstToPdf } from '../lib/typstRenderer';

const toolbarButtonClass = 'shrink-0 border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900';

export function ResumePreviewPanel() {
  const {
    resume,
    documents,
    activeDocumentId,
    typstSource,
    svgHtml,
    setSvgHtml,
    renderStatus,
    setRenderStatus,
    renderError,
  } = useResumeGeneratorStore();
  const { t } = useI18n();

  const previewRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [zoom, setZoom] = React.useState(75);
  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
  const documentTitle = activeDocument?.title || resume.title;
  const readiness = getExportReadiness(resume);

  const triggerRender = useCallback(async () => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    renderTimeoutRef.current = setTimeout(async () => {
      setRenderStatus('rendering');
      try {
        const result = await renderTypst(typstSource);
        if (result.ok) {
          setSvgHtml(result.svgHtml || null);
          setRenderStatus('success');
        } else {
          setSvgHtml(null);
          setRenderStatus('error', result.error || t('preview.renderFailed'));
        }
      } catch (err) {
        setSvgHtml(null);
        setRenderStatus('error', formatError(err));
      }
    }, 600);
  }, [setRenderStatus, setSvgHtml, t, typstSource]);

  useEffect(() => {
    triggerRender();
    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [triggerRender]);

  const handleCopyTypst = async () => {
    try {
      await copyTypstSource(typstSource);
      toast.success(t('toast.copiedToClipboard'));
    } catch (err) {
      toast.error(t('toast.failedToCopy'), { description: formatError(err) });
    }
  };

  const handleDownloadTypst = () => {
    try {
      downloadTypstSource(typstSource, resume, documentTitle);
      toast.success(t('toast.typstDownloaded'));
    } catch (err) {
      toast.error(t('toast.failedToDownload'), { description: formatError(err) });
    }
  };

  const handleDownloadPdf = async () => {
    const issueCodes = readiness.issues.map(issue => issue.code);
    trackAnalyticsEvent('export_started', {
      format: 'pdf',
      issueCodes,
    });
    let stage: 'render' | 'download' = 'render';
    try {
      const result = await renderTypstToPdf(typstSource);
      if (!result.ok) {
        throw new Error(result.error || t('preview.pdfRenderFailed'));
      }

      stage = 'download';
      await exportPdf(resume, result.pdfBlob, documentTitle);
      trackAnalyticsEvent('export_completed', {
        format: 'pdf',
        issueCodes,
      });
      toast.success(t('toast.pdfDownloaded'));
    } catch (err) {
      trackAnalyticsEvent('export_failed', {
        format: 'pdf',
        issueCodes,
        reason: stage === 'render' ? 'render_failed' : 'download_failed',
      });
      toast.error(t('toast.failedToDownloadPdf'), { description: formatError(err) });
    }
  };

  const handleZoomIn = () => setZoom(currentZoom => Math.min(currentZoom + 25, 200));
  const handleZoomOut = () => setZoom(currentZoom => Math.max(currentZoom - 25, 50));

  return (
    <div className="hidden min-h-0 min-w-0 flex-1 flex-col bg-slate-100 lg:flex">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 text-slate-900">
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
                {t('common.error')}
              </>
            ) : (
              <>
                <span className="mr-1 h-2 w-2 rounded-full bg-green-500" />
                {t('status.ready')}
              </>
            )}
          </Badge>
          {renderError && (
            <span className="min-w-0 max-w-[360px] truncate text-xs text-rose-600">{renderError}</span>
          )}
          <Badge variant="outline" className="max-w-full rounded border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
            {t('exportPanel.previewDocumentBadge', { title: documentTitle })}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="outline" className={toolbarButtonClass} onClick={handleZoomOut} disabled={zoom <= 50} title={t('preview.zoomOut')}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm tabular-nums text-slate-600">{zoom}%</span>
          <Button size="sm" variant="outline" className={toolbarButtonClass} onClick={handleZoomIn} disabled={zoom >= 200} title={t('preview.zoomIn')}>
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
          <Button size="sm" className="shrink-0 bg-blue-600 text-white hover:bg-blue-500" onClick={handleDownloadPdf}>
            <FileDown className="mr-1 h-4 w-4 shrink-0" />
            {t('common.pdf')}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full items-start justify-center p-4 sm:p-8">
          <Tabs defaultValue="preview" className="w-full max-w-[800px]">
            <TabsList className="w-full justify-start rounded-md border border-slate-200 bg-white p-1 text-slate-500">
              <TabsTrigger value="preview" className="rounded data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none">{t('tabs.preview')}</TabsTrigger>
              <TabsTrigger value="source" className="rounded data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none">{t('tabs.source')}</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="mt-4">
              <div
                ref={previewRef}
                className="origin-top rounded-sm bg-white shadow-2xl shadow-slate-400/20 transition-transform"
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
                    <p className="text-lg font-medium text-rose-600">{t('preview.renderingError')}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{renderError}</p>
                  </div>
                )}
                {renderStatus === 'success' && svgHtml && (
                  <div
                    className="typst-preview"
                    dangerouslySetInnerHTML={{ __html: svgHtml }}
                  />
                )}
                {renderStatus === 'idle' && (
                  <div className="flex h-full min-h-[400px] items-center justify-center">
                    <p className="text-slate-500">{t('preview.startEditing')}</p>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="source" className="mt-4">
              <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-100 p-4 font-mono text-xs text-slate-700 shadow-xl shadow-slate-300/20">
                {typstSource}
              </pre>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
