import React from 'react';
import {
  AlignLeft,
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  FileText,
  FileUp,
  FolderGit2,
  GraduationCap,
  History,
  Languages,
  Layers,
  Loader2,
  Palette,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n';
import { useI18n } from '@/i18n/useI18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@/i18n/types';
import { PdfDocumentAnalysis, PdfIntakeResponse, PdfSelectionRequiredResponse, ResumeData, ResumeIntakeResult, ResumeIntakeUsage } from '@/types/resume';
import { accentPaletteOptions, densityOptions, pageSizeOptions, typographyOptions } from '../data/resumeDesign';
import { resolveTemplateId, resumeTemplates } from '../data/resumeTemplates';
import { buildResumeExportFileName, copyTypstSource, downloadTypstSource, exportPdf } from '../lib/exportResume';
import { analyzeExportReadiness, type ExportReadinessIssue, type ExportReadinessLevel, type ExportReadinessSection, type ExportReadinessSeverity } from '../lib/exportReadiness';
import { formatError } from '../lib/formatError';
import { formatIntakeWarningMessage } from '../lib/formatIntakeWarning';
import { applyIntakeDraftToResume, getPdfAnalysisTone, type PdfPageRangeValidationError, validatePdfPageRange } from '../lib/pdfIntakeFlow';
import { generateResumeFromPdf, generateResumeFromText, getIntakeUsage } from '../lib/resumeIntake';
import { isStarterResume, shouldShowFirstRunOnboarding } from '../lib/resumeOnboarding';
import { renderTypstToPdf } from '../lib/typstRenderer';
import { ResumeDocumentSwitcher } from './ResumeDocumentSwitcher';
import { ResumeTailoringPanel } from './ResumeTailoringPanel';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const inputClass = 'h-8 border-slate-200 bg-white text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500';
const textareaClass = 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500';
const ghostButtonClass = 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900';

type StartIntakeMode = 'text' | 'pdf';
type IntakeStatus = 'idle' | 'uploading' | 'extracting' | 'generating' | 'needsSelection' | 'error' | 'success';
type ExportStatus = 'idle' | 'generating' | 'success' | 'error';
type IntakeFailureReason = 'validation' | 'quota' | 'network' | 'server' | 'unknown';

function classifyIntakeFailureReason(error: unknown): IntakeFailureReason {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (!message) return 'unknown';
  if (/quota|limit|exhaust|too many|429/.test(message)) return 'quota';
  if (/network|fetch|connection|offline|timeout|timed out/.test(message)) return 'network';
  if (/server|internal|unavailable|gateway|50\d/.test(message)) return 'server';
  if (/valid|minimum|too short|unsupported|invalid|required|empty/.test(message)) return 'validation';
  return 'unknown';
}

export function ResumeEditorPanel() {
  const { resume, documents, renderStatus, hasDismissedOnboarding, dismissOnboarding } = useResumeGeneratorStore();
  const { locale, t } = useI18n();
  const showFirstRunOnboarding = shouldShowFirstRunOnboarding({ documents, hasDismissedOnboarding }, locale);
  const isStarterContent = isStarterResume(resume, locale);
  const [activeTab, setActiveTab] = React.useState(showFirstRunOnboarding ? 'start' : 'content');

  const handleTabChange = React.useCallback((value: string) => {
    setActiveTab(value);
    if (value === 'export') {
      trackAnalyticsEvent('export_tab_viewed', {});
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col border-b border-slate-200 bg-slate-50 text-slate-900 shadow-2xl shadow-slate-400/20 lg:flex-none lg:border-b-0 lg:border-r lg:w-[520px] lg:min-w-[430px] lg:max-w-[560px]">
      <div className="border-b border-slate-200 bg-white px-4 pb-3 pt-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">{t('editor.eyebrow')}</p>
            <h1 className="mt-1 line-clamp-2 text-lg font-semibold leading-6 text-slate-900" title={resume.title}>{resume.title}</h1>
          </div>

          <div className="w-full space-y-2 sm:w-[156px] sm:shrink-0">
            <LanguageSwitcher />
            <div className="flex sm:justify-end">
              <StatusPill status={renderStatus} />
            </div>
          </div>
        </div>
        <ResumeDocumentSwitcher className="mt-3" />
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <TabsList className="grid h-auto min-h-9 w-full grid-cols-5 rounded-md border border-slate-200 bg-slate-100 p-1 text-slate-500">
            <TabsTrigger value="start" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.start')}
            </TabsTrigger>
            <TabsTrigger value="content" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.content')}
            </TabsTrigger>
            <TabsTrigger value="design" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.design')}
            </TabsTrigger>
            <TabsTrigger value="tailor" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.tailor')}
            </TabsTrigger>
            <TabsTrigger value="export" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.export')}
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="start" className="m-0 space-y-3 p-4">
            <StartIntakeSection
              showOnboarding={showFirstRunOnboarding}
              onDismissOnboarding={dismissOnboarding}
              onGoToContent={() => setActiveTab('content')}
              onGoToTailor={() => setActiveTab('tailor')}
            />
          </TabsContent>

          <TabsContent value="content" className="m-0 space-y-3 p-4">
            {isStarterContent ? <ContextHint title={t('onboarding.context.contentTitle')} description={t('onboarding.context.contentDescription')} /> : null}
            <BasicsSection />
            <SummarySection />
            <ExperienceSection />
            <EducationSection />
            <SkillsSection />
            <ProjectsSection />
          </TabsContent>

          <TabsContent value="design" className="m-0 space-y-3 p-4">
            <DesignSection />
          </TabsContent>

          <TabsContent value="tailor" className="m-0 space-y-3 p-4">
            {isStarterContent ? <ContextHint title={t('onboarding.context.tailorTitle')} description={t('onboarding.context.tailorDescription')} /> : null}
            <ResumeTailoringPanel />
          </TabsContent>

          <TabsContent value="export" className="m-0 space-y-3 p-4">
            {isStarterContent ? <ContextHint title={t('onboarding.context.exportTitle')} description={t('onboarding.context.exportDescription')} /> : null}
            <ExportSection />
            <VersionHistorySection />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('localeSwitcher.label')}</Label>
      <Select value={locale} onValueChange={value => setLocale(value as SupportedLocale)}>
        <SelectTrigger aria-label={t('localeSwitcher.label')} className="h-8 border-slate-200 bg-white px-2.5 text-xs text-slate-900 ring-offset-0 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0">
          <div className="flex items-center gap-2">
            <Languages className="h-3.5 w-3.5 text-blue-600" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent className="border-slate-200 bg-white text-slate-900">
          {SUPPORTED_LOCALES.map(item => (
            <SelectItem key={item} value={item} className="focus:bg-slate-100 focus:text-slate-900">
              {LOCALE_LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="px-0.5 text-[10px] leading-snug text-slate-500">{t('localeSwitcher.hint')}</p>
    </div>
  );
}

function StatusPill({ status }: { status: 'idle' | 'rendering' | 'success' | 'error' }) {
  const { t } = useI18n();

  const statusConfig = {
    idle: { label: t('status.idle'), className: 'border-slate-500/40 text-slate-600', dot: 'bg-slate-400' },
    rendering: { label: t('status.rendering'), className: 'border-blue-300 text-blue-600', dot: 'bg-blue-600' },
    success: { label: t('status.ready'), className: 'border-emerald-200 text-emerald-700', dot: 'bg-emerald-300' },
    error: { label: t('status.error'), className: 'border-rose-200 text-rose-700', dot: 'bg-rose-300' },
  }[status];

  return (
    <Badge variant="outline" className={cn('gap-1.5 rounded border bg-slate-50 px-2 py-1 text-[11px]', statusConfig.className)}>
      {status === 'rendering' ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={cn('h-1.5 w-1.5 rounded-full', statusConfig.dot)} />}
      {statusConfig.label}
    </Badge>
  );
}

function ControlGroup({
  title,
  icon: Icon,
  count,
  meta,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count?: number;
  meta?: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-lg shadow-slate-300/20">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <button type="button" onClick={() => setIsOpen(open => !open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
          <Icon className="h-4 w-4 text-blue-600" />
          <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
          {typeof count === 'number' && <Badge className="h-5 rounded bg-slate-200 px-1.5 text-[10px] text-slate-700 hover:bg-slate-200">{count}</Badge>}
          {meta && <span className="hidden truncate text-xs text-slate-500 sm:block">{meta}</span>}
        </button>
        {action}
      </div>
      {isOpen && <div className="space-y-3 p-3">{children}</div>}
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">{label}</div>;
}

export function StartIntakeSection({
  showOnboarding = false,
  onDismissOnboarding,
  onGoToContent,
  onGoToTailor,
}: {
  showOnboarding?: boolean;
  onDismissOnboarding?: () => void;
  onGoToContent: () => void;
  onGoToTailor?: () => void;
}) {
  const { resume, setResume, saveVersion, setLastIntakeWarnings } = useResumeGeneratorStore();
  const { t } = useI18n();
  const activeTemplate = resumeTemplates.find(template => template.id === resolveTemplateId(resume.templateId)) || resumeTemplates[0];
  const activeTemplateName = t(activeTemplate.nameKey);
  const pdfInputRef = React.useRef<HTMLInputElement | null>(null);
  const pdfStatusTimeoutsRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const paragraphTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [activeMode, setActiveMode] = React.useState<StartIntakeMode>('text');
  const [usage, setUsage] = React.useState<ResumeIntakeUsage | null>(null);
  const [text, setText] = React.useState('');
  const [draft, setDraft] = React.useState<ResumeIntakeResult | null>(null);
  const [pdfFile, setPdfFile] = React.useState<File | null>(null);
  const [pdfAnalysis, setPdfAnalysis] = React.useState<PdfDocumentAnalysis | null>(null);
  const [pageSelection, setPageSelection] = React.useState<PdfSelectionRequiredResponse | null>(null);
  const [pageStart, setPageStart] = React.useState('1');
  const [pageEnd, setPageEnd] = React.useState('1');
  const [intakeStatus, setIntakeStatus] = React.useState<IntakeStatus>('idle');
  const [selectedPdfName, setSelectedPdfName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const isGenerating = intakeStatus === 'generating';
  const isBusy = intakeStatus === 'uploading' || intakeStatus === 'extracting' || intakeStatus === 'generating';

  const refreshUsage = React.useCallback(async () => {
    try {
      setUsage(await getIntakeUsage());
    } catch (err) {
      setError(formatError(err, t));
    }
  }, []);

  React.useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const clearPdfStatusTimers = React.useCallback(() => {
    pdfStatusTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    pdfStatusTimeoutsRef.current = [];
  }, []);

  React.useEffect(() => () => clearPdfStatusTimers(), [clearPdfStatusTimers]);

  // Focus the paragraph textarea whenever the user lands in text intake mode so the
  // "Paste text" action feels like it opens the flow rather than just toggling it.
  React.useEffect(() => {
    if (activeMode !== 'text') return;
    paragraphTextareaRef.current?.focus();
  }, [activeMode]);

  const hydratePageSelectionInputs = React.useCallback((response: PdfSelectionRequiredResponse) => {
    setPageStart(String(response.selectedPageRange?.start || 1));
    setPageEnd(String(response.selectedPageRange?.end || 1));
  }, []);

  const applyPdfResponse = React.useCallback((response: PdfIntakeResponse) => {
    setPdfAnalysis(response.analysis);

    if (response.kind === 'selection_required') {
      if (response.analysis.classification === 'likely_packet') {
        trackAnalyticsEvent('pdf_packet_blocked', {
          pageCount: response.analysis.pageCount,
          signalCodes: response.analysis.signals.map(signal => signal.code),
        });
      }
      setDraft(null);
      setPageSelection(response);
      hydratePageSelectionInputs(response);
      setIntakeStatus('needsSelection');
      return;
    }

    setPageSelection(null);
    setDraft(response.draft);
    setIntakeStatus('success');
    trackAnalyticsEvent('intake_completed', {
      source: 'pdf',
      warningCodes: response.draft.warnings.map(warning => warning.code),
      usedFallback: response.draft.warnings.some(warning => warning.code === 'MODEL_GATEWAY_FAILED' || warning.code === 'MODEL_GATEWAY_NOT_CONFIGURED'),
      usedOcr: response.draft.warnings.some(warning => warning.code === 'PDF_USED_OCR'),
    });
  }, [hydratePageSelectionInputs]);

  const runPdfImport = React.useCallback(async (
    file: File,
    options?: { pageStart: number; pageEnd: number },
  ) => {
    setActiveMode('pdf');
    setSelectedPdfName(file.name);
    setPdfFile(file);
    setDraft(null);
    setError(null);
    schedulePdfProgress();

    try {
      const response = await generateResumeFromPdf(file, options);
      clearPdfStatusTimers();
      applyPdfResponse(response);
      if (response.kind === 'draft') {
        await refreshUsage();
      }
    } catch (err) {
      clearPdfStatusTimers();
      setError(formatError(err, t));
      setIntakeStatus('error');
      trackAnalyticsEvent('intake_failed', { source: 'pdf', reason: classifyIntakeFailureReason(err) });
      await refreshUsage();
    }
  }, [applyPdfResponse, clearPdfStatusTimers, refreshUsage]);

  const setMode = (mode: StartIntakeMode) => {
    trackAnalyticsEvent('intake_started', { source: mode });
    setActiveMode(mode);
    if (!draft) {
      setError(null);
      setIntakeStatus('idle');
    }
  };

  const schedulePdfProgress = () => {
    clearPdfStatusTimers();
    setIntakeStatus('uploading');
    pdfStatusTimeoutsRef.current = [
      setTimeout(() => {
        setIntakeStatus(current => (current === 'uploading' ? 'extracting' : current));
      }, 240),
      setTimeout(() => {
        setIntakeStatus(current => (current === 'uploading' || current === 'extracting' ? 'generating' : current));
      }, 1000),
    ];
  };

  const handleGenerate = async () => {
    if (text.trim().length < 20) {
      setError(t('intake.paragraph.minimumLengthError'));
      setIntakeStatus('error');
      trackAnalyticsEvent('intake_failed', { source: 'text', reason: 'validation' });
      return;
    }

    setActiveMode('text');
  trackAnalyticsEvent('intake_started', { source: 'text' });
    setPdfAnalysis(null);
    setPageSelection(null);
    setPdfFile(null);
    setIntakeStatus('generating');
    setError(null);
    try {
      const result = await generateResumeFromText(text);
      setDraft(result);
      setIntakeStatus('success');
      trackAnalyticsEvent('intake_completed', {
        source: 'text',
        warningCodes: result.warnings.map(warning => warning.code),
        usedFallback: result.warnings.some(warning => warning.code === 'MODEL_GATEWAY_FAILED' || warning.code === 'MODEL_GATEWAY_NOT_CONFIGURED'),
      });
      await refreshUsage();
    } catch (err) {
      setError(formatError(err, t));
      setIntakeStatus('error');
      trackAnalyticsEvent('intake_failed', { source: 'text', reason: classifyIntakeFailureReason(err) });
      await refreshUsage();
    }
  };

  const handleChoosePdf = () => {
    setActiveMode('pdf');
    trackAnalyticsEvent('intake_started', { source: 'pdf' });
    if (!isBusy && !draft) {
      pdfInputRef.current?.click();
    }
  };

  const handlePdfSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfFile(null);
      setPdfAnalysis(null);
      setPageSelection(null);
      setSelectedPdfName(null);
      setDraft(null);
      setError(t('intake.pdf.invalidFileError'));
      setIntakeStatus('error');
      trackAnalyticsEvent('intake_failed', { source: 'pdf', reason: 'validation' });
      return;
    }

    await runPdfImport(file);
  };

  const handleGenerateFromSelectedPages = async () => {
    if (!pdfFile || !pageSelection) return;

    const validation = validatePdfPageRange(pageStart, pageEnd, pageSelection.analysis.pageCount);
    if (!validation.ok) {
      setError(getPdfPageRangeErrorMessage(validation.error, t));
      return;
    }

    setError(null);
    trackAnalyticsEvent('pdf_page_range_selected', {
      pageCount: pageSelection.analysis.pageCount,
      selectedPageCount: validation.pageRange.end - validation.pageRange.start + 1,
    });
    await runPdfImport(pdfFile, validation.pageRange);
  };

  const handleApplyDraft = () => {
    if (!draft) return;

    setResume(applyIntakeDraftToResume(resume, draft.resume));
    setLastIntakeWarnings(draft.warnings);
    saveVersion(draft.source.kind === 'pdf' ? t('versionHistory.pdfDraftLabel') : t('versionHistory.paragraphDraftLabel'));
    toast.success(t('toast.draftApplied'));
    onGoToContent();
  };

  const handleResetDraft = () => {
    const sourceKind = draft?.source.kind;
    setDraft(null);
    setError(null);
    setPdfAnalysis(null);
    setPageSelection(null);
    setIntakeStatus('idle');

    if (sourceKind === 'pdf') {
      setActiveMode('pdf');
      setPdfFile(null);
      setSelectedPdfName(null);
      setPageStart('1');
      setPageEnd('1');
      return;
    }

    setActiveMode('text');
  };

  const pdfAnalysisTone = getPdfAnalysisTone(pdfAnalysis);

  return (
    <>
      {showOnboarding ? (
        <FirstRunWelcomePanel
          onDismiss={onDismissOnboarding}
          onStartWithSample={() => {
            onDismissOnboarding?.();
            onGoToContent();
          }}
          onPasteText={() => setMode('text')}
          onUploadPdf={handleChoosePdf}
          onTailorLater={onGoToTailor}
        />
      ) : null}

      <ControlGroup
        title={t('sections.assistedStart')}
        icon={PenLine}
        meta={
          usage
            ? t('intake.usage.startsRemainingWithTemplate', {
                remaining: usage.remainingAttempts,
                limit: usage.limit,
                templateName: activeTemplateName,
              })
            : t('intake.usage.checkingUsage')
        }
        defaultOpen
      >
        <div className="grid gap-2 md:grid-cols-3">
          <StartModeCard
            icon={FileText}
            title={t('actions.startFromText')}
            description={t('intake.cards.startFromTextDescription')}
            active={activeMode === 'text'}
            onClick={() => setMode('text')}
          />
          <StartModeCard
            icon={FileUp}
            title={t('actions.uploadPdf')}
            description={t('intake.cards.uploadPdfDescription')}
            active={activeMode === 'pdf'}
            onClick={handleChoosePdf}
            disabled={isBusy || Boolean(draft)}
          />
          <StartModeCard
            icon={PenLine}
            title={t('actions.startManually')}
            description={t('intake.cards.startManuallyDescription')}
            onClick={onGoToContent}
          />
        </div>
      </ControlGroup>

      {activeMode === 'text' ? (
        <ControlGroup title={t('sections.paragraphIntake')} icon={FileText} meta={t('intake.paragraph.sourceMaterial')} defaultOpen>
          <Textarea
            ref={paragraphTextareaRef}
            className={cn(textareaClass, 'min-h-36 resize-none')}
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder={t('placeholders.paragraphExample')}
            disabled={isBusy || Boolean(draft)}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{t('intake.paragraph.attemptsHelper')}</p>
            <Button className="h-9 bg-blue-600 text-white hover:bg-blue-500" onClick={handleGenerate} disabled={isBusy || Boolean(draft) || text.trim().length < 20 || usage?.remainingAttempts === 0}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {t('actions.generateDraft')}
            </Button>
          </div>
          <IntakeStatusNotice mode="text" status={intakeStatus} />
          {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{error}</p>}
        </ControlGroup>
      ) : (
        <ControlGroup title={t('sections.pdfIntake')} icon={FileUp} meta={t('intake.pdf.uploadMeta')} defaultOpen>
          <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdfSelected} />
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-900">{t('intake.pdf.uploadTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('intake.pdf.uploadDescription')}</p>
            {selectedPdfName && <p className="mt-3 text-xs text-slate-500">{t('intake.pdf.selectedFile', { fileName: selectedPdfName })}</p>}
          </div>
          {pageSelection && (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-amber-700">{t('intake.pdf.selectionTitle')}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-700">{t('intake.pdf.selectionDescription')}</p>
                </div>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  {t(getPdfAnalysisLabelKey(pageSelection.analysis))}
                </Badge>
              </div>

              <p className="text-xs text-amber-700">{t('intake.pdf.pageCount', { count: pageSelection.analysis.pageCount })}</p>

              {pageSelection.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {pageSelection.warnings.map(warning => (
                    <div key={`${warning.code}-${warning.fieldPath || warning.message}`} className="flex gap-2 rounded-md border border-amber-200 bg-slate-50 px-2 py-1.5 text-xs text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{formatIntakeWarningMessage(warning, t)}</span>
                    </div>
                  ))}
                </div>
              )}

              {pageSelection.analysis.signals.length > 0 && (
                <div className="space-y-1.5">
                  {pageSelection.analysis.signals.map(signal => (
                    <div key={signal.code} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                      {signal.message}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Field label={t('intake.pdf.pageStartLabel')}>
                  <Input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={pageSelection.analysis.pageCount}
                    value={pageStart}
                    onChange={event => setPageStart(event.target.value)}
                    disabled={isBusy}
                  />
                </Field>
                <Field label={t('intake.pdf.pageEndLabel')}>
                  <Input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={pageSelection.analysis.pageCount}
                    value={pageEnd}
                    onChange={event => setPageEnd(event.target.value)}
                    disabled={isBusy}
                  />
                </Field>
              </div>

              <p className="text-xs text-amber-700">{t('intake.pdf.pageRangeHelper')}</p>

              <Button className="h-9 w-full bg-blue-600 text-white hover:bg-blue-500" onClick={handleGenerateFromSelectedPages} disabled={isBusy || !pdfFile}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                {t('actions.generateDraftFromPages')}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{t('intake.pdf.helper')}</p>
            <Button className="h-9 bg-blue-600 text-white hover:bg-blue-500" onClick={handleChoosePdf} disabled={isBusy || Boolean(draft) || usage?.remainingAttempts === 0}>
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {selectedPdfName ? t('actions.chooseAnotherPdf') : t('actions.choosePdf')}
            </Button>
          </div>
          <IntakeStatusNotice mode="pdf" status={intakeStatus} fileName={selectedPdfName} />
          {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{error}</p>}
        </ControlGroup>
      )}

      {draft && (
        <ControlGroup title={t('sections.reviewDraft')} icon={Check} meta={t('intake.review.confidence', { count: Math.round(draft.confidence.overall * 100) })} defaultOpen>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            <DraftStat label={t('intake.review.source')} value={t(draft.source.kind === 'pdf' ? 'intake.sourceKind.pdf' : 'intake.sourceKind.text')} />
            <DraftStat label={t('intake.review.template')} value={activeTemplateName} />
            <DraftStat label={t('intake.review.experience')} value={draft.resume.experience.length} />
            <DraftStat label={t('intake.review.education')} value={draft.resume.education.length} />
            <DraftStat label={t('intake.review.skillGroups')} value={draft.resume.skills.length} />
            <DraftStat label={t('intake.review.warnings')} value={draft.warnings.length} />
            {draft.source.kind === 'pdf' && pdfAnalysis && (
              <DraftStat label={t('intake.review.documentRisk')} value={t(getPdfAnalysisLabelKey(pdfAnalysis))} />
            )}
            {draft.source.kind === 'pdf' && pdfAnalysis?.analyzedPageRange && (
              <DraftStat label={t('intake.review.pageRange')} value={t('intake.review.pageRangeValue', {
                start: pdfAnalysis.analyzedPageRange.start,
                end: pdfAnalysis.analyzedPageRange.end,
                count: pdfAnalysis.pageCount,
              })} />
            )}
          </div>

          {draft.source.kind === 'pdf' && pdfAnalysis && (pdfAnalysisTone !== 'normal' || pdfAnalysis.analyzedPageRange || pdfAnalysis.signals.length > 0) && (
            <div className={cn(
              'space-y-2 rounded-md border p-3',
              pdfAnalysisTone === 'blocked' && 'border-rose-200 bg-rose-50',
              pdfAnalysisTone === 'review' && 'border-amber-200 bg-amber-50',
              pdfAnalysisTone === 'normal' && 'border-slate-200 bg-slate-50',
            )}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">{t('intake.review.analysisTitle')}</p>
                <Badge variant="outline" className={cn(
                  pdfAnalysisTone === 'blocked' && 'border-rose-200 bg-rose-50 text-rose-700',
                  pdfAnalysisTone === 'review' && 'border-amber-200 bg-amber-50 text-amber-700',
                  pdfAnalysisTone === 'normal' && 'border-slate-200 bg-slate-50 text-slate-600',
                )}>
                  {t(getPdfAnalysisLabelKey(pdfAnalysis))}
                </Badge>
              </div>

              <p className="text-xs text-slate-500">
                {pdfAnalysis.analyzedPageRange
                  ? t('intake.review.pageRangeValue', {
                      start: pdfAnalysis.analyzedPageRange.start,
                      end: pdfAnalysis.analyzedPageRange.end,
                      count: pdfAnalysis.pageCount,
                    })
                  : t('intake.pdf.pageCount', { count: pdfAnalysis.pageCount })}
              </p>

              {pdfAnalysis.signals.length > 0 && (
                <div className="space-y-1.5">
                  {pdfAnalysis.signals.map(signal => (
                    <div key={signal.code} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                      {signal.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-900">{draft.resume.personal.fullName}</p>
            <p className="mt-1 text-xs text-slate-500">{draft.resume.personal.headline}</p>
            <p className="mt-2 line-clamp-3 text-xs text-slate-500">{draft.resume.summary}</p>
          </div>

          {draft.warnings.length > 0 && (
            <div className="space-y-1.5">
              {draft.warnings.map(warning => (
                <div key={`${warning.code}-${warning.fieldPath || warning.message}`} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{formatIntakeWarningMessage(warning, t)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className={cn('h-9 flex-1 justify-start', ghostButtonClass)} onClick={handleResetDraft}>
              <ArrowLeft className="h-4 w-4" />
              {draft.source.kind === 'pdf' ? t('actions.chooseAnotherPdf') : t('actions.editInput')}
            </Button>
            <Button className="h-9 flex-1 bg-blue-600 text-white hover:bg-blue-500" onClick={handleApplyDraft}>
              <Check className="h-4 w-4" />
              {t('actions.applyDraft')}
            </Button>
          </div>
        </ControlGroup>
      )}
    </>
  );
}

function FirstRunWelcomePanel({
  onDismiss,
  onStartWithSample,
  onPasteText,
  onUploadPdf,
  onTailorLater,
}: {
  onDismiss?: () => void;
  onStartWithSample: () => void;
  onPasteText: () => void;
  onUploadPdf: () => void;
  onTailorLater?: () => void;
}) {
  const { t } = useI18n();
  const valueProps = ['intake', 'draft', 'export'] as const;

  React.useEffect(() => {
    trackAnalyticsEvent('onboarding_viewed', { surface: 'start_tab' });
  }, []);

  const handleDismiss = () => {
    trackAnalyticsEvent('onboarding_dismissed', { surface: 'start_tab' });
    onDismiss?.();
  };

  const handleStartWithSample = () => {
    trackAnalyticsEvent('start_action_clicked', { action: 'sample' });
    onStartWithSample();
  };

  const handlePasteText = () => {
    trackAnalyticsEvent('start_action_clicked', { action: 'paste_text' });
    onPasteText();
  };

  const handleUploadPdf = () => {
    trackAnalyticsEvent('start_action_clicked', { action: 'upload_pdf' });
    onUploadPdf();
  };

  return (
    <section className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">{t('onboarding.eyebrow')}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{t('onboarding.title')}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">{t('onboarding.description')}</p>
        </div>
        {onDismiss ? (
          <Button type="button" variant="outline" className="h-8 shrink-0 border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100" onClick={handleDismiss}>
            {t('onboarding.dismiss')}
          </Button>
        ) : null}
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {valueProps.map((prop, index) => (
          <li key={prop} className="rounded border border-slate-200 bg-white px-3 py-2.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">{index + 1}</span>
            <span className="mt-2 block text-xs font-medium leading-5 text-slate-700">{t(`onboarding.valueProps.${prop}`)}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-2 sm:grid-cols-3">
        <Button type="button" className="h-auto min-w-0 justify-start whitespace-normal bg-blue-600 p-3 text-left text-white hover:bg-blue-500" onClick={handleStartWithSample}>
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">{t('onboarding.actions.startWithSample')}</span>
        </Button>
        <Button type="button" variant="outline" className="h-auto min-w-0 justify-start whitespace-normal border-slate-300 bg-white p-3 text-left text-slate-800 hover:bg-slate-100" onClick={handlePasteText}>
          <FileText className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">{t('onboarding.actions.pasteText')}</span>
        </Button>
        <Button type="button" variant="outline" className="h-auto min-w-0 justify-start whitespace-normal border-slate-300 bg-white p-3 text-left text-slate-800 hover:bg-slate-100" onClick={handleUploadPdf}>
          <FileUp className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">{t('onboarding.actions.uploadPdf')}</span>
        </Button>
      </div>

      <p className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] leading-4 text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('onboarding.localOnlyNote')}
      </p>

      <button type="button" className="block text-left text-xs leading-5 text-slate-500 hover:text-slate-700" onClick={onTailorLater}>
        {t('onboarding.tailorLater')}
      </button>
    </section>
  );
}

function ContextHint({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function StartModeCard({
  icon: Icon,
  title,
  description,
  active,
  disabled,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border p-3 text-left transition',
        active ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-slate-50',
      )}
    >
      <Icon className="mb-2 h-4 w-4 text-blue-600" />
      <span className="block text-xs font-semibold text-slate-900">{title}</span>
      <span className="mt-1 block text-[11px] leading-4 text-slate-500">{description}</span>
    </button>
  );
}

function DraftStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function IntakeStatusNotice({ mode, status, fileName }: { mode: StartIntakeMode; status: IntakeStatus; fileName?: string | null }) {
  const { t } = useI18n();

  const config = {
    idle: {
      icon: mode === 'pdf' ? FileUp : FileText,
      className: 'border-slate-200 bg-slate-50 text-slate-500',
      label: mode === 'pdf' ? t('intake.notices.idlePdf') : t('intake.notices.idleText'),
    },
    uploading: {
      icon: Loader2,
      className: 'border-blue-200 bg-blue-100 text-blue-700',
      label: t('intake.notices.uploading', { fileName: fileName || t('common.pdf') }),
    },
    extracting: {
      icon: Loader2,
      className: 'border-blue-200 bg-blue-100 text-blue-700',
      label: t('intake.notices.extracting'),
    },
    generating: {
      icon: Loader2,
      className: 'border-blue-200 bg-blue-100 text-blue-700',
      label: mode === 'pdf' ? t('intake.notices.generatingPdf') : t('intake.notices.generatingText'),
    },
    needsSelection: {
      icon: AlertTriangle,
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      label: t('intake.notices.selectionRequired'),
    },
    error: {
      icon: AlertTriangle,
      className: 'border-rose-200 bg-rose-50 text-rose-700',
      label: mode === 'pdf' ? t('intake.notices.errorPdf') : t('intake.notices.errorText'),
    },
    success: {
      icon: Check,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      label: mode === 'pdf' ? t('intake.notices.successPdf') : t('intake.notices.successText'),
    },
  }[status];

  const Icon = config.icon;

  return (
    <div className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs', config.className)}>
      <Icon className={cn('h-3.5 w-3.5 shrink-0', status === 'uploading' || status === 'extracting' || status === 'generating' ? 'animate-spin' : '')} />
      <span>{config.label}</span>
    </div>
  );
}

function getPdfAnalysisLabelKey(analysis: PdfDocumentAnalysis): 'intake.analysis.singleResume' | 'intake.analysis.likelyPacket' | 'intake.analysis.uncertain' {
  switch (analysis.classification) {
    case 'likely_packet':
      return 'intake.analysis.likelyPacket';
    case 'uncertain':
      return 'intake.analysis.uncertain';
    default:
      return 'intake.analysis.singleResume';
  }
}

function getPdfPageRangeErrorMessage(error: PdfPageRangeValidationError, t: (key: any, params?: any) => string): string {
  switch (error) {
    case 'missing':
      return t('intake.pdf.rangeRequiredError');
    case 'integer':
      return t('intake.pdf.rangeIntegerError');
    case 'order':
      return t('intake.pdf.rangeOrderError');
    case 'bounds':
      return t('intake.pdf.rangeBoundsError');
    default:
      return t('intake.pdf.rangeIntegerError');
  }
}

function BasicsSection() {
  const { resume, setResume, updatePersonal } = useResumeGeneratorStore();
  const { t } = useI18n();
  const { personal } = resume;

  return (
    <ControlGroup title={t('sections.basics')} icon={UserRound} meta={t('meta.identityAndContact')} defaultOpen>
      <Field label={t('fields.resumeTitle')}>
        <Input className={inputClass} value={resume.title} onChange={event => setResume({ ...resume, title: event.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('fields.fullName')}>
          <Input className={inputClass} value={personal.fullName} onChange={event => updatePersonal({ fullName: event.target.value })} placeholder={t('placeholders.fullName')} />
        </Field>
        <Field label={t('fields.headline')}>
          <Input className={inputClass} value={personal.headline} onChange={event => updatePersonal({ headline: event.target.value })} placeholder={t('placeholders.headline')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('fields.email')}>
          <Input className={inputClass} type="email" value={personal.email} onChange={event => updatePersonal({ email: event.target.value })} placeholder={t('placeholders.email')} />
        </Field>
        <Field label={t('fields.phone')}>
          <Input className={inputClass} value={personal.phone} onChange={event => updatePersonal({ phone: event.target.value })} placeholder={t('placeholders.phone')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('fields.location')}>
          <Input className={inputClass} value={personal.location} onChange={event => updatePersonal({ location: event.target.value })} placeholder={t('placeholders.location')} />
        </Field>
        <Field label={t('fields.website')}>
          <Input className={inputClass} value={personal.website || ''} onChange={event => updatePersonal({ website: event.target.value })} placeholder={t('placeholders.website')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('fields.linkedin')}>
          <Input className={inputClass} value={personal.linkedin || ''} onChange={event => updatePersonal({ linkedin: event.target.value })} placeholder={t('placeholders.linkedin')} />
        </Field>
        <Field label={t('fields.github')}>
          <Input className={inputClass} value={personal.github || ''} onChange={event => updatePersonal({ github: event.target.value })} placeholder={t('placeholders.github')} />
        </Field>
      </div>
    </ControlGroup>
  );
}

function SummarySection() {
  const { resume, updateSummary } = useResumeGeneratorStore();
  const { t } = useI18n();

  return (
    <ControlGroup title={t('sections.summary')} icon={AlignLeft} meta={t('meta.characters', { count: resume.summary.length })} defaultOpen>
      <Textarea
        className={cn(textareaClass, 'min-h-24 resize-none')}
        value={resume.summary}
        onChange={event => updateSummary(event.target.value)}
        placeholder={t('placeholders.summary')}
      />
    </ControlGroup>
  );
}

function ExperienceSection() {
  const { resume, addExperience, updateExperience, removeExperience } = useResumeGeneratorStore();
  const { t } = useI18n();

  return (
    <ControlGroup
      title={t('sections.experience')}
      icon={Briefcase}
      count={resume.experience.length}
      action={<AddButton onClick={addExperience} label={t('actions.add')} />}
    >
      {resume.experience.map(experience => (
        <ExperienceItem
          key={experience.id}
          experience={experience}
          onUpdate={updates => updateExperience(experience.id, updates)}
          onRemove={() => removeExperience(experience.id)}
        />
      ))}
      {resume.experience.length === 0 && <EmptyState label={t('empty.experience')} />}
    </ControlGroup>
  );
}

function ExperienceItem({
  experience,
  onUpdate,
  onRemove,
}: {
  experience: ResumeData['experience'][number];
  onUpdate: (updates: Partial<ResumeData['experience'][number]>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  return (
    <ItemShell title={experience.role || t('items.untitledRole')} subtitle={experience.company || t('items.company')} onRemove={onRemove}>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('fields.role')}>
          <Input className={inputClass} value={experience.role} onChange={event => onUpdate({ role: event.target.value })} placeholder={t('placeholders.role')} />
        </Field>
        <Field label={t('fields.company')}>
          <Input className={inputClass} value={experience.company} onChange={event => onUpdate({ company: event.target.value })} placeholder={t('placeholders.company')} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('fields.start')}>
          <Input className={inputClass} value={experience.startDate} onChange={event => onUpdate({ startDate: event.target.value })} placeholder={t('placeholders.experienceStart')} />
        </Field>
        <Field label={t('fields.end')}>
          <Input
            className={inputClass}
            value={experience.endDate}
            onChange={event => onUpdate({ endDate: event.target.value })}
            placeholder={t('placeholders.experienceEnd')}
            disabled={experience.current}
          />
        </Field>
        <Field label={t('fields.location')}>
          <Input className={inputClass} value={experience.location || ''} onChange={event => onUpdate({ location: event.target.value })} placeholder={t('placeholders.experienceLocation')} />
        </Field>
      </div>
      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={Boolean(experience.current)}
          onChange={event => onUpdate({ current: event.target.checked, endDate: event.target.checked ? '' : experience.endDate })}
          className="h-3.5 w-3.5 accent-blue-600"
        />
        {t('items.currentlyWorkingHere')}
      </label>
      <BulletList bullets={experience.bullets} onChange={bullets => onUpdate({ bullets })} placeholder={t('placeholders.bullet')} />
    </ItemShell>
  );
}

function EducationSection() {
  const { resume, addEducation, updateEducation, removeEducation } = useResumeGeneratorStore();
  const { t } = useI18n();

  return (
    <ControlGroup title={t('sections.education')} icon={GraduationCap} count={resume.education.length} action={<AddButton onClick={addEducation} label={t('actions.add')} />}>
      {resume.education.map(education => (
        <ItemShell
          key={education.id}
          title={education.school || t('items.untitledSchool')}
          subtitle={[education.degree, education.field].filter(Boolean).join(' · ') || t('items.degree')}
          onRemove={() => removeEducation(education.id)}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('fields.school')}>
              <Input className={inputClass} value={education.school} onChange={event => updateEducation(education.id, { school: event.target.value })} placeholder={t('placeholders.school')} />
            </Field>
            <Field label={t('fields.location')}>
              <Input className={inputClass} value={education.location || ''} onChange={event => updateEducation(education.id, { location: event.target.value })} placeholder={t('placeholders.educationLocation')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('fields.degree')}>
              <Input className={inputClass} value={education.degree} onChange={event => updateEducation(education.id, { degree: event.target.value })} placeholder={t('placeholders.degree')} />
            </Field>
            <Field label={t('fields.field')}>
              <Input className={inputClass} value={education.field || ''} onChange={event => updateEducation(education.id, { field: event.target.value })} placeholder={t('placeholders.field')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('fields.start')}>
              <Input className={inputClass} value={education.startDate || ''} onChange={event => updateEducation(education.id, { startDate: event.target.value })} placeholder={t('placeholders.educationStart')} />
            </Field>
            <Field label={t('fields.end')}>
              <Input className={inputClass} value={education.endDate || ''} onChange={event => updateEducation(education.id, { endDate: event.target.value })} placeholder={t('placeholders.educationEnd')} />
            </Field>
          </div>
        </ItemShell>
      ))}
      {resume.education.length === 0 && <EmptyState label={t('empty.education')} />}
    </ControlGroup>
  );
}

function SkillsSection() {
  const { resume, addSkill, updateSkill, removeSkill } = useResumeGeneratorStore();
  const { t } = useI18n();

  return (
    <ControlGroup title={t('sections.skills')} icon={Wrench} count={resume.skills.length} action={<AddButton onClick={addSkill} label={t('actions.add')} />}>
      {resume.skills.map(skill => (
        <ItemShell key={skill.id} title={skill.category || t('items.untitledCategory')} subtitle={t('items.skillsCount', { count: skill.items.length })} onRemove={() => removeSkill(skill.id)}>
          <Field label={t('fields.category')}>
            <Input className={inputClass} value={skill.category} onChange={event => updateSkill(skill.id, { category: event.target.value })} placeholder={t('placeholders.skillCategory')} />
          </Field>
          <Field label={t('fields.skills')}>
            <Input
              className={inputClass}
              value={skill.items.join(', ')}
              onChange={event => updateSkill(skill.id, { items: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}
              placeholder={t('placeholders.skillItems')}
            />
          </Field>
        </ItemShell>
      ))}
      {resume.skills.length === 0 && <EmptyState label={t('empty.skills')} />}
    </ControlGroup>
  );
}

function ProjectsSection() {
  const { resume, addProject, updateProject, removeProject } = useResumeGeneratorStore();
  const { t } = useI18n();

  return (
    <ControlGroup title={t('sections.projects')} icon={FolderGit2} count={resume.projects.length} action={<AddButton onClick={addProject} label={t('actions.add')} />}>
      {resume.projects.map(project => (
        <ItemShell key={project.id} title={project.name || t('items.untitledProject')} subtitle={project.url || t('items.project')} onRemove={() => removeProject(project.id)}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('fields.name')}>
              <Input className={inputClass} value={project.name} onChange={event => updateProject(project.id, { name: event.target.value })} placeholder={t('placeholders.projectName')} />
            </Field>
            <Field label={t('fields.url')}>
              <Input className={inputClass} value={project.url || ''} onChange={event => updateProject(project.id, { url: event.target.value })} placeholder={t('placeholders.projectUrl')} />
            </Field>
          </div>
          <Field label={t('fields.description')}>
            <Input className={inputClass} value={project.description} onChange={event => updateProject(project.id, { description: event.target.value })} placeholder={t('placeholders.projectDescription')} />
          </Field>
          <BulletList bullets={project.bullets} onChange={bullets => updateProject(project.id, { bullets })} placeholder={t('placeholders.projectBullet')} />
        </ItemShell>
      ))}
      {resume.projects.length === 0 && <EmptyState label={t('empty.projects')} />}
    </ControlGroup>
  );
}

function BulletList({ bullets, onChange, placeholder }: { bullets: string[]; onChange: (bullets: string[]) => void; placeholder: string }) {
  const { t } = useI18n();

  return (
    <Field label={t('fields.bullets')}>
      <div className="space-y-1.5">
        {bullets.map((bullet, bulletIndex) => (
          <div key={bulletIndex} className="flex gap-1.5">
            <Input
              className={inputClass}
              value={bullet}
              onChange={event => {
                const nextBullets = [...bullets];
                nextBullets[bulletIndex] = event.target.value;
                onChange(nextBullets);
              }}
              placeholder={placeholder}
            />
            <Button size="icon" variant="ghost" title={t('actions.delete')} className="h-8 w-8 shrink-0 text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => onChange(bullets.filter((_, index) => index !== bulletIndex))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-600 hover:bg-blue-100 hover:text-blue-700" onClick={() => onChange([...bullets, ''])}>
          <Plus className="h-3.5 w-3.5" />
          {t('actions.addBullet')}
        </Button>
      </div>
    </Field>
  );
}

function ItemShell({ title, subtitle, onRemove, children }: { title: string; subtitle: string; onRemove: () => void; children: React.ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{title}</p>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>
        <Button size="icon" variant="ghost" title={t('actions.delete')} className="h-8 w-8 shrink-0 text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="outline" className={cn('h-7 px-2 text-xs', ghostButtonClass)} onClick={onClick}>
      <Plus className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function DesignSection() {
  const { resume, setTemplate, updateDesign } = useResumeGeneratorStore();
  const { t } = useI18n();
  const { design } = resume;

  return (
    <>
      <ControlGroup title={t('sections.template')} icon={Layers} meta={t('meta.layoutSystem')} defaultOpen>
        <div className="grid gap-3">
          {resumeTemplates.map(template => {
            const isActive = resolveTemplateId(resume.templateId) === template.id;
            return (
              <TemplateSelectionCard key={template.id} template={template} isActive={isActive} onSelect={() => setTemplate(template.id)} />
            );
          })}
        </div>
      </ControlGroup>

      <ControlGroup title={t('sections.typography')} icon={FileText} meta={t('meta.voiceAndTexture')} defaultOpen>
        <SegmentedControl options={typographyOptions.map(option => ({ id: option.id, label: t(option.labelKey), description: t(option.descriptionKey) }))} value={design.typography} onChange={typography => updateDesign({ typography })} />
      </ControlGroup>

      <ControlGroup title={t('sections.layout')} icon={SlidersHorizontal} meta={t('meta.densityAndPage')} defaultOpen>
        <Field label={t('fields.density')}>
          <SegmentedControl options={densityOptions.map(option => ({ id: option.id, label: t(option.labelKey), description: t(option.descriptionKey) }))} value={design.density} onChange={density => updateDesign({ density })} />
        </Field>
        <Field label={t('fields.page')}>
          <SegmentedControl options={pageSizeOptions.map(option => ({ id: option.id, label: t(option.labelKey), description: t(option.descriptionKey) }))} value={design.pageSize} onChange={pageSize => updateDesign({ pageSize })} />
        </Field>
      </ControlGroup>

      <ControlGroup title={t('sections.accent')} icon={Palette} meta={design.accentColor} defaultOpen>
        <div className="grid grid-cols-6 gap-2">
          {accentPaletteOptions.map(preset => {
            const isActive = preset.value.toLowerCase() === design.accentColor.toLowerCase();
            return (
              <button
                key={preset.value}
                type="button"
                title={t(preset.nameKey)}
                onClick={() => updateDesign({ accentColor: preset.value })}
                className={cn('flex h-9 items-center justify-center rounded-md border bg-slate-50 transition', isActive ? 'border-slate-400' : 'border-slate-200 hover:border-slate-300')}
              >
                <span className="h-5 w-5 rounded-full border border-slate-300" style={{ backgroundColor: preset.value }} />
              </button>
            );
          })}
        </div>
      </ControlGroup>
    </>
  );
}

function TemplateSelectionCard({
  template,
  isActive,
  onSelect,
}: {
  template: (typeof resumeTemplates)[number];
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-xl border p-3 text-left transition',
        isActive ? 'border-blue-300 bg-blue-100 text-blue-700 shadow-lg shadow-blue-200/50' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100',
      )}
    >
      <div className="grid gap-3 md:grid-cols-[170px_1fr] md:items-start">
        <div className={cn('overflow-hidden rounded-xl border bg-slate-100', isActive ? 'border-blue-200' : 'border-slate-200')}>
          <div className="aspect-[4/3] bg-white">
            <img
              src={template.preview.imagePath}
              alt={t(template.nameKey)}
              className="h-full w-full object-cover object-top"
              loading="lazy"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-50">{t(template.nameKey)}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{t(template.descriptionKey)}</p>
            </div>
            {isActive ? (
              <Badge variant="outline" className="border-blue-300 bg-blue-100 text-blue-700">
                <Check className="mr-1 h-3 w-3" />
                {t('common.current')}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">{t('common.select')}</Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
              {t(template.preview.layoutLabelKey)}
            </Badge>
            {template.preview.tagKeys.map(tagKey => (
              <Badge key={`${template.id}-${tagKey}`} variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">
                {t(tagKey)}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: TValue; label: string; description?: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(option => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            title={option.description}
            onClick={() => onChange(option.id)}
            className={cn(
              'min-h-10 rounded px-2 py-1.5 text-center transition',
              isActive ? 'bg-blue-600 text-white shadow-sm shadow-slate-400/20' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <span className="block text-xs font-semibold">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ExportSection() {
  const { resume, typstSource, documents, activeDocumentId, renderStatus, renderError, svgHtml, lastIntakeWarnings } = useResumeGeneratorStore();
  const { t } = useI18n();
  const [exportStatus, setExportStatus] = React.useState<ExportStatus>('idle');
  const [lastExportFileName, setLastExportFileName] = React.useState<string | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);
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
  const isDownloadingPdf = exportStatus === 'generating';
  const isPdfTechnicallyBlocked = readiness.issues.some(issue => issue.code === 'RENDER_ERROR' || issue.code === 'TYPST_SOURCE_EMPTY');

  const handleCopyTypst = async () => {
    try {
      await copyTypstSource(typstSource);
      toast.success(t('toast.copiedSource'));
    } catch (error) {
      toast.error(t('toast.copyFailed'), { description: formatError(error, t) });
    }
  };

  const handleDownloadTypst = () => {
    try {
      downloadTypstSource(typstSource, resume, documentTitle);
      toast.success(t('toast.typstDownloaded'));
    } catch (error) {
      toast.error(t('toast.downloadFailed'), { description: formatError(error, t) });
    }
  };

  const handleDownloadPdf = async () => {
    setExportStatus('generating');
    setExportError(null);
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
      const fileName = await exportPdf(resume, result.pdfBlob, documentTitle);
      setLastExportFileName(fileName);
      setExportStatus('success');
      trackAnalyticsEvent('export_completed', {
        format: 'pdf',
        issueCodes,
      });
      toast.success(t('toast.pdfDownloaded'));
    } catch (error) {
      setExportStatus('error');
      setExportError(formatError(error, t));
      trackAnalyticsEvent('export_failed', {
        format: 'pdf',
        issueCodes,
        reason: stage === 'render' ? 'render_failed' : 'download_failed',
      });
      toast.error(t('toast.pdfDownloadFailed'), { description: formatError(error, t) });
    }
  };

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
              {readiness.level === 'ready' ? t('exportReadiness.readyTitle') : readiness.level === 'blocked' ? t('exportReadiness.blockedTitle') : t('exportReadiness.needsReviewTitle')}
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
            <ExportSummaryItem label={t('exportPanel.lastUpdated')} value={activeDocument?.updatedAt ? formatExportDate(activeDocument.updatedAt) : t('exportPanel.missingValue')} />
            <ExportSummaryItem label={t('exportPanel.fileName')} value={pdfFileName} />
          </dl>
        </div>

        {exportStatus !== 'idle' ? (
          <div className={`rounded-md border px-3 py-2 text-xs ${exportStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : exportStatus === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
            {exportStatus === 'generating' ? t('exportPanel.generatingPdf') : exportStatus === 'success' ? t('exportPanel.exportedFile', { fileName: lastExportFileName || pdfFileName }) : t('exportPanel.exportFailed', { message: exportError || t('preview.pdfRenderFailed') })}
          </div>
        ) : null}

        <div className="grid gap-2">
          <Button className="h-auto min-h-10 justify-start whitespace-normal bg-blue-600 text-left text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60" onClick={handleDownloadPdf} disabled={isDownloadingPdf || isPdfTechnicallyBlocked}>
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
  const sortedIssues = React.useMemo(() => [...readiness.issues].sort((left, right) => severityRank(left.severity) - severityRank(right.severity)), [readiness.issues]);
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
          {!compact && issue.descriptionKey ? (
            <p className="text-xs leading-5 text-slate-500">{t(issue.descriptionKey)}</p>
          ) : null}
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

function formatExportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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

function VersionHistorySection() {
  const { versions, restoreVersion, deleteVersion, saveVersion } = useResumeGeneratorStore();
  const { t } = useI18n();

  return (
    <ControlGroup
      title={t('sections.snapshots')}
      icon={History}
      count={versions.length}
      defaultOpen
      action={
        <Button size="sm" variant="outline" className={cn('h-7 px-2 text-xs', ghostButtonClass)} onClick={() => saveVersion(t('versionHistory.manualSaveLabel'))}>
          <Save className="h-3.5 w-3.5" />
          {t('actions.save')}
        </Button>
      }
    >
      {versions.length === 0 ? (
        <EmptyState label={t('versionHistory.noSavedSnapshots')} />
      ) : (
        <div className="space-y-2">
          {versions.map(version => (
            <div key={version.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-700">{version.label}</p>
                <p className="text-[11px] text-slate-500">{new Date(version.createdAt).toLocaleString()}</p>
              </div>
              <Button size="icon" variant="ghost" title={t('actions.restore')} className="h-8 w-8 text-slate-500 hover:bg-blue-100 hover:text-blue-600" onClick={() => restoreVersion(version)}>
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title={t('actions.delete')} className="h-8 w-8 text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => deleteVersion(version.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </ControlGroup>
  );
}
