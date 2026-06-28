import React from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Download, FileDown, Loader2, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import { formatLocaleDateTime } from '@/lib/formatLocaleDate';
import type { TranslationKey } from '@/i18n/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveTemplateId, resumeTemplates } from '../data/resumeTemplates';
import { buildResumeExportFileName } from '../lib/exportResume';
import {
  analyzeExportReadiness,
  type ExportReadinessIssue,
  type ExportReadinessLevel,
  type ExportReadinessSection,
  type ExportReadinessSeverity,
} from '../lib/exportReadiness';
import { useResumeExport } from '../hooks/useResumeExport';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';
import { ControlGroup } from './editorUi';
import { ghostButtonClass, primaryButtonClass } from './editorStyles';

export function ExportSection() {
  const { resume, typstSource, documents, activeDocumentId, renderStatus, renderError, svgHtml, lastIntakeWarnings } =
    useResumeGeneratorStore();
  const { t, locale } = useI18n();
  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
  const documentTitle = activeDocument?.title || resume.title;
  const resolvedTemplateId = resolveTemplateId(resume.templateId);
  const activeTemplate = resumeTemplates.find(template => template.id === resolvedTemplateId) || resumeTemplates[0];
  const validTemplateIds = React.useMemo(() => {
    const templateIds = resumeTemplates.map(template => template.id);
    return templateIds.includes(resolvedTemplateId) ? [...templateIds, resume.templateId] : templateIds;
  }, [resolvedTemplateId, resume.templateId]);
  const readiness = analyzeExportReadiness({
    resume,
    typstSource,
    renderStatus,
    renderError,
    svgHtml,
    templateIds: validTemplateIds,
    intakeWarnings: lastIntakeWarnings,
  });
  const pdfFileName = buildResumeExportFileName(resume, 'pdf', documentTitle);
  const typFileName = buildResumeExportFileName(resume, 'typ', documentTitle);
  const isPdfTechnicallyBlocked = readiness.issues.some(
    issue => issue.code === 'RENDER_ERROR' || issue.code === 'TYPST_SOURCE_EMPTY',
  );
  const {
    pdfExportStatus,
    lastExportFileName,
    exportError,
    isDownloadingPdf,
    handleCopyTypst,
    handleDownloadTypst,
    handleDownloadPdf,
  } = useResumeExport({
    variant: 'panel',
    issueCodes: readiness.issues.map(issue => issue.code),
  });

  return (
    <ControlGroup title={t('sections.exportActions')} icon={FileDown} meta={t('meta.sourceChars', { count: typstSource.length.toLocaleString() })} defaultOpen>
      <div className="space-y-3">
        <ExportReadinessPanel readiness={readiness} />

        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{t('exportPanel.summaryTitle')}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{t('exportPanel.summaryDescription')}</p>
            </div>
            <Badge className={getReadinessLevelClassName(readiness.level)}>
              {readiness.level === 'ready'
                ? t('exportReadiness.readyTitle')
                : readiness.level === 'blocked'
                  ? t('exportReadiness.blockedTitle')
                  : t('exportReadiness.needsReviewTitle')}
            </Badge>
          </div>
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-sm font-semibold text-blue-700">{t('exportPanel.activeDocumentTitle', { title: documentTitle })}</p>
            <p className="mt-1 text-xs leading-5 text-blue-700">{t('exportPanel.activeDocumentDescription')}</p>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <ExportSummaryItem label={t('exportPanel.documentTitle')} value={documentTitle} />
            <ExportSummaryItem label={t('exportPanel.candidateName')} value={resume.personal.fullName || t('exportPanel.missingValue')} />
            <ExportSummaryItem label={t('exportPanel.template')} value={t(activeTemplate.nameKey)} />
            <ExportSummaryItem label={t('exportPanel.pageSize')} value={t(`design.pageSize.${resume.design.pageSize}.label`)} />
            <ExportSummaryItem
              label={t('exportPanel.lastUpdated')}
              value={activeDocument?.updatedAt ? formatLocaleDateTime(activeDocument.updatedAt, locale) : t('exportPanel.missingValue')}
            />
            <ExportSummaryItem label={t('exportPanel.fileName')} value={pdfFileName} />
          </dl>
        </div>

        {pdfExportStatus !== 'idle' ? (
          <div
            className={`rounded-md border px-3 py-2 text-xs ${pdfExportStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : pdfExportStatus === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}
          >
            {pdfExportStatus === 'generating'
              ? t('exportPanel.generatingPdf')
              : pdfExportStatus === 'success'
                ? t('exportPanel.exportedFile', { fileName: lastExportFileName || pdfFileName })
                : t('exportPanel.exportFailed', { message: exportError || t('preview.pdfRenderFailed') })}
          </div>
        ) : null}

        <div className="grid gap-2">
          <Button
            className={cn('h-auto min-h-10 justify-start whitespace-normal text-left disabled:cursor-not-allowed disabled:opacity-60', primaryButtonClass)}
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf || isPdfTechnicallyBlocked}
          >
            {isDownloadingPdf ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileDown className="h-4 w-4 shrink-0" />}
            <span className="min-w-0">{isDownloadingPdf ? t('exportPanel.generatingPdf') : t('actions.downloadPdf')}</span>
          </Button>
          {isPdfTechnicallyBlocked ? (
            <p className="break-words text-[11px] leading-4 text-rose-700">{t('exportReadiness.technicalBlock')}</p>
          ) : readiness.level !== 'ready' ? (
            <p className="break-words text-[11px] leading-4 text-amber-700">{t('exportReadiness.exportAnyway')}</p>
          ) : null}
          <p className="break-words text-[11px] leading-4 text-slate-500">{t('exportPanel.pdfPrimaryHelper', { fileName: pdfFileName })}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" className={cn('h-auto min-h-9 justify-start whitespace-normal text-left', ghostButtonClass)} onClick={handleDownloadTypst}>
              <Download className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{t('actions.downloadTypst')}</span>
            </Button>
            <Button variant="outline" className={cn('h-auto min-h-9 justify-start whitespace-normal text-left', ghostButtonClass)} onClick={handleCopyTypst}>
              <Copy className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{t('actions.copySource')}</span>
            </Button>
          </div>
          <p className="break-words text-[11px] leading-4 text-slate-500">{t('exportPanel.typstHelper', { fileName: typFileName })}</p>
        </div>
      </div>
    </ControlGroup>
  );
}

function ExportReadinessPanel({ readiness }: { readiness: ReturnType<typeof analyzeExportReadiness> }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = React.useState(false);
  const sortedIssues = React.useMemo(
    () => [...readiness.issues].sort((left, right) => severityRank(left.severity) - severityRank(right.severity)),
    [readiness.issues],
  );
  const visibleIssues = showAll ? sortedIssues : sortedIssues.slice(0, 6);
  const visiblePasses = showAll ? readiness.passes : readiness.passes.slice(0, 4);
  const hiddenCount = sortedIssues.length + readiness.passes.length - visibleIssues.length - visiblePasses.length;

  return (
    <div className={cn('space-y-3 rounded-md border p-3', getReadinessPanelClassName(readiness.level))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('exportReadiness.title')}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            {getReadinessLevelIcon(readiness.level)}
            <p className="text-sm font-semibold text-slate-900">{t(getReadinessLevelTitleKey(readiness.level))}</p>
            <Badge variant="outline" className="rounded border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700">
              {t('exportReadiness.scoreLabel', { score: readiness.score })}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t('exportReadiness.summary', {
              blockers: readiness.summary.blockerCount,
              warnings: readiness.summary.warningCount,
              suggestions: readiness.summary.suggestionCount,
            })}
          </p>
        </div>
      </div>

      {visibleIssues.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">{t('exportReadiness.needsAttention')}</p>
          <ul className="space-y-1.5">
            {visibleIssues.map(issue => (
              <ReadinessIssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        </div>
      ) : null}

      {visiblePasses.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">{t('exportReadiness.passedChecks')}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {visiblePasses.map(issue => (
              <ReadinessIssueRow key={issue.id} issue={issue} compact />
            ))}
          </ul>
        </div>
      ) : null}

      {hiddenCount > 0 || showAll ? (
        <Button type="button" variant="ghost" className="h-7 px-2 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900" onClick={() => setShowAll(current => !current)}>
          {showAll ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAll ? t('exportReadiness.showLess') : t('exportReadiness.showAll')}
        </Button>
      ) : null}
    </div>
  );
}

function ReadinessIssueRow({ issue, compact = false }: { issue: ExportReadinessIssue; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <li className={cn('rounded border px-2 py-1.5', getSeverityClassName(issue.severity), compact ? 'flex items-center gap-2' : 'space-y-1')}>
      <div className="flex min-w-0 items-start gap-2">
        {getSeverityIcon(issue.severity)}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 text-xs font-semibold leading-5 text-slate-900">{t(issue.titleKey)}</span>
            {issue.section ? (
              <Badge variant="outline" className="rounded border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] text-slate-600">
                {t(getSectionLabelKey(issue.section))}
              </Badge>
            ) : null}
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{t(getSeverityLabelKey(issue.severity))}</span>
          </div>
          {!compact && issue.descriptionKey ? <p className="text-xs leading-5 text-slate-500">{t(issue.descriptionKey)}</p> : null}
        </div>
      </div>
    </li>
  );
}

function ExportSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-700">{value}</dd>
    </div>
  );
}



function severityRank(severity: ExportReadinessSeverity): number {
  if (severity === 'blocker') return 0;
  if (severity === 'warning') return 1;
  if (severity === 'suggestion') return 2;
  return 3;
}

function getReadinessLevelTitleKey(level: ExportReadinessLevel): TranslationKey {
  if (level === 'blocked') return 'exportReadiness.blockedTitle';
  if (level === 'needs_review') return 'exportReadiness.needsReviewTitle';
  return 'exportReadiness.readyTitle';
}

function getReadinessLevelClassName(level: ExportReadinessLevel): string {
  if (level === 'blocked') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (level === 'needs_review') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function getReadinessPanelClassName(level: ExportReadinessLevel): string {
  if (level === 'blocked') return 'border-rose-200 bg-rose-50';
  if (level === 'needs_review') return 'border-amber-200 bg-amber-50';
  return 'border-emerald-200 bg-emerald-50';
}

function getReadinessLevelIcon(level: ExportReadinessLevel) {
  if (level === 'blocked') return <AlertTriangle className="h-4 w-4 text-rose-600" />;
  if (level === 'needs_review') return <AlertTriangle className="h-4 w-4 text-amber-700" />;
  return <ShieldCheck className="h-4 w-4 text-emerald-600" />;
}

function getSeverityClassName(severity: ExportReadinessSeverity): string {
  if (severity === 'blocker') return 'border-rose-200 bg-rose-50';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50';
  if (severity === 'suggestion') return 'border-blue-200 bg-blue-50';
  return 'border-emerald-200 bg-emerald-50';
}

function getSeverityIcon(severity: ExportReadinessSeverity) {
  if (severity === 'pass') return <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (severity === 'blocker') return <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-rose-600" />;
  if (severity === 'warning') return <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-700" />;
  return <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-blue-600" />;
}

function getSeverityLabelKey(severity: ExportReadinessSeverity): TranslationKey {
  if (severity === 'blocker') return 'exportReadiness.severity.blocker';
  if (severity === 'warning') return 'exportReadiness.severity.warning';
  if (severity === 'suggestion') return 'exportReadiness.severity.suggestion';
  return 'exportReadiness.severity.pass';
}

function getSectionLabelKey(section: ExportReadinessSection): TranslationKey {
  switch (section) {
    case 'personal':
      return 'exportReadiness.sections.personal';
    case 'summary':
      return 'exportReadiness.sections.summary';
    case 'experience':
      return 'exportReadiness.sections.experience';
    case 'education':
      return 'exportReadiness.sections.education';
    case 'skills':
      return 'exportReadiness.sections.skills';
    case 'projects':
      return 'exportReadiness.sections.projects';
    case 'design':
      return 'exportReadiness.sections.design';
    case 'export':
      return 'exportReadiness.sections.export';
  }
}