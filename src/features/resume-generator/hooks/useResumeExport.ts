import React from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/i18n/useI18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { copyTypstSource, downloadTypstSource, exportPdf } from '../lib/exportResume';
import { formatError } from '../lib/formatError';
import { renderTypstToPdf } from '../lib/typstRenderer';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

export type ResumeExportVariant = 'toolbar' | 'panel';
export type PdfExportStatus = 'idle' | 'generating' | 'success' | 'error';

type UseResumeExportOptions = {
  variant: ResumeExportVariant;
  issueCodes?: string[];
};

export function useResumeExport({ variant, issueCodes = [] }: UseResumeExportOptions) {
  const { resume, typstSource, documents, activeDocumentId } = useResumeGeneratorStore();
  const { t } = useI18n();
  const [pdfExportStatus, setPdfExportStatus] = React.useState<PdfExportStatus>('idle');
  const [lastExportFileName, setLastExportFileName] = React.useState<string | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
  const documentTitle = activeDocument?.title || resume.title;

  const handleCopyTypst = React.useCallback(async () => {
    try {
      await copyTypstSource(typstSource);
      toast.success(t(variant === 'toolbar' ? 'toast.copiedToClipboard' : 'toast.copiedSource'));
    } catch (error) {
      toast.error(t(variant === 'toolbar' ? 'toast.failedToCopy' : 'toast.copyFailed'), {
        description: formatError(error, t),
      });
    }
  }, [t, typstSource, variant]);

  const handleDownloadTypst = React.useCallback(() => {
    try {
      downloadTypstSource(typstSource, resume, documentTitle);
      toast.success(t('toast.typstDownloaded'));
    } catch (error) {
      toast.error(t(variant === 'toolbar' ? 'toast.failedToDownload' : 'toast.downloadFailed'), {
        description: formatError(error, t),
      });
    }
  }, [documentTitle, resume, t, typstSource, variant]);

  const handleDownloadPdf = React.useCallback(async () => {
    if (variant === 'panel') {
      setPdfExportStatus('generating');
      setExportError(null);
    }

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
      const fileName = await exportPdf(resume, result.pdfBlob, documentTitle);

      if (variant === 'panel') {
        setLastExportFileName(fileName);
        setPdfExportStatus('success');
      }

      trackAnalyticsEvent('export_completed', {
        format: 'pdf',
        issueCodes,
      });
      toast.success(t('toast.pdfDownloaded'));
    } catch (error) {
      const message = formatError(error, t);

      if (variant === 'panel') {
        setPdfExportStatus('error');
        setExportError(message);
      }

      trackAnalyticsEvent('export_failed', {
        format: 'pdf',
        issueCodes,
        reason: stage === 'render' ? 'render_failed' : 'download_failed',
      });
      toast.error(t(variant === 'toolbar' ? 'toast.failedToDownloadPdf' : 'toast.pdfDownloadFailed'), {
        description: message,
      });
    }
  }, [documentTitle, issueCodes, resume, t, typstSource, variant]);

  return {
    documentTitle,
    pdfExportStatus,
    lastExportFileName,
    exportError,
    isDownloadingPdf: pdfExportStatus === 'generating',
    handleCopyTypst,
    handleDownloadTypst,
    handleDownloadPdf,
  };
}