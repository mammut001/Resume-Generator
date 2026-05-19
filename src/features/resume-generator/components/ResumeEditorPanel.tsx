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
import { PdfDocumentAnalysis, PdfIntakeResponse, PdfSelectionRequiredResponse, ResumeData, ResumeIntakeResult, ResumeIntakeUsage } from '@/types/resume';
import { accentPaletteOptions, densityOptions, pageSizeOptions, typographyOptions } from '../data/resumeDesign';
import { resolveTemplateId, resumeTemplates } from '../data/resumeTemplates';
import { buildResumeExportFileName, copyTypstSource, downloadTypstSource, exportPdf } from '../lib/exportResume';
import { getExportReadiness, type ExportReadinessIssueCode } from '../lib/exportReadiness';
import { formatError } from '../lib/formatError';
import { formatIntakeWarningMessage } from '../lib/formatIntakeWarning';
import { applyIntakeDraftToResume, getPdfAnalysisTone, type PdfPageRangeValidationError, validatePdfPageRange } from '../lib/pdfIntakeFlow';
import { generateResumeFromPdf, generateResumeFromText, getIntakeUsage } from '../lib/resumeIntake';
import { isStarterResume, shouldShowFirstRunOnboarding } from '../lib/resumeOnboarding';
import { renderTypstToPdf } from '../lib/typstRenderer';
import { ResumeDocumentSwitcher } from './ResumeDocumentSwitcher';
import { ResumeTailoringPanel } from './ResumeTailoringPanel';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const inputClass = 'h-8 border-white/10 bg-black/25 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-400';
const textareaClass = 'border-white/10 bg-black/25 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-400';
const ghostButtonClass = 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white';

type StartIntakeMode = 'text' | 'pdf';
type IntakeStatus = 'idle' | 'uploading' | 'extracting' | 'generating' | 'needsSelection' | 'error' | 'success';
type ExportStatus = 'idle' | 'generating' | 'success' | 'error';

export function ResumeEditorPanel() {
  const { resume, documents, renderStatus, hasDismissedOnboarding, dismissOnboarding } = useResumeGeneratorStore();
  const { locale, t } = useI18n();
  const showFirstRunOnboarding = shouldShowFirstRunOnboarding({ documents, hasDismissedOnboarding }, locale);
  const isStarterContent = isStarterResume(resume, locale);
  const [activeTab, setActiveTab] = React.useState(showFirstRunOnboarding ? 'start' : 'content');

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col border-b border-zinc-800 bg-[#10100f] text-slate-100 shadow-2xl shadow-black/30 lg:flex-none lg:border-b-0 lg:border-r lg:w-[520px] lg:min-w-[430px] lg:max-w-[560px]">
      <div className="border-b border-white/10 bg-[#171612] px-4 pb-3 pt-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">{t('editor.eyebrow')}</p>
            <h1 className="mt-1 line-clamp-2 text-lg font-semibold leading-6 text-white" title={resume.title}>{resume.title}</h1>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-white/10 bg-[#171612] px-4 py-3">
          <TabsList className="grid h-auto min-h-9 w-full grid-cols-5 rounded-md border border-white/10 bg-black/30 p-1 text-slate-400">
            <TabsTrigger value="start" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.start')}
            </TabsTrigger>
            <TabsTrigger value="content" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.content')}
            </TabsTrigger>
            <TabsTrigger value="design" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.design')}
            </TabsTrigger>
            <TabsTrigger value="tailor" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none sm:text-sm">
              {t('tabs.tailor')}
            </TabsTrigger>
            <TabsTrigger value="export" className="min-w-0 rounded px-2 text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none sm:text-sm">
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
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t('localeSwitcher.label')}</Label>
      <Select value={locale} onValueChange={value => setLocale(value as SupportedLocale)}>
        <SelectTrigger aria-label={t('localeSwitcher.label')} className="h-8 border-white/10 bg-black/25 px-2.5 text-xs text-slate-100 ring-offset-0 focus:ring-1 focus:ring-cyan-400 focus:ring-offset-0">
          <div className="flex items-center gap-2">
            <Languages className="h-3.5 w-3.5 text-cyan-300" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent className="border-white/10 bg-[#171612] text-slate-100">
          {SUPPORTED_LOCALES.map(item => (
            <SelectItem key={item} value={item} className="focus:bg-white/10 focus:text-white">
              {LOCALE_LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusPill({ status }: { status: 'idle' | 'rendering' | 'success' | 'error' }) {
  const { t } = useI18n();

  const statusConfig = {
    idle: { label: t('status.idle'), className: 'border-slate-500/40 text-slate-300', dot: 'bg-slate-400' },
    rendering: { label: t('status.rendering'), className: 'border-cyan-400/40 text-cyan-200', dot: 'bg-cyan-300' },
    success: { label: t('status.ready'), className: 'border-emerald-400/40 text-emerald-200', dot: 'bg-emerald-300' },
    error: { label: t('status.error'), className: 'border-rose-400/40 text-rose-200', dot: 'bg-rose-300' },
  }[status];

  return (
    <Badge variant="outline" className={cn('gap-1.5 rounded border bg-black/20 px-2 py-1 text-[11px]', statusConfig.className)}>
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
    <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] shadow-lg shadow-black/10">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.025] px-3 py-2">
        <button type="button" onClick={() => setIsOpen(open => !open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          <Icon className="h-4 w-4 text-cyan-300" />
          <span className="truncate text-sm font-semibold text-slate-100">{title}</span>
          {typeof count === 'number' && <Badge className="h-5 rounded bg-white/10 px-1.5 text-[10px] text-slate-200 hover:bg-white/10">{count}</Badge>}
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
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</Label>
      {children}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-white/10 bg-black/10 px-3 py-5 text-center text-xs text-slate-500">{label}</div>;
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
  const { resume, setResume, saveVersion } = useResumeGeneratorStore();
  const { t } = useI18n();
  const activeTemplate = resumeTemplates.find(template => template.id === resolveTemplateId(resume.templateId)) || resumeTemplates[0];
  const activeTemplateName = t(activeTemplate.nameKey);
  const pdfInputRef = React.useRef<HTMLInputElement | null>(null);
  const pdfStatusTimeoutsRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
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
      setError(formatError(err));
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
      setError(formatError(err));
      setIntakeStatus('error');
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
      setError(formatError(err));
      setIntakeStatus('error');
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
          onPasteText={() => setMode('text')}
          onUploadPdf={handleChoosePdf}
          onStartManually={onGoToContent}
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
            className={cn(textareaClass, 'min-h-36 resize-none')}
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder={t('placeholders.paragraphExample')}
            disabled={isBusy || Boolean(draft)}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{t('intake.paragraph.attemptsHelper')}</p>
            <Button className="h-9 bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={handleGenerate} disabled={isBusy || Boolean(draft) || text.trim().length < 20 || usage?.remainingAttempts === 0}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {t('actions.generateDraft')}
            </Button>
          </div>
          <IntakeStatusNotice mode="text" status={intakeStatus} />
          {error && <p className="rounded-md border border-rose-400/20 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">{error}</p>}
        </ControlGroup>
      ) : (
        <ControlGroup title={t('sections.pdfIntake')} icon={FileUp} meta={t('intake.pdf.uploadMeta')} defaultOpen>
          <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdfSelected} />
          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-medium text-slate-100">{t('intake.pdf.uploadTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('intake.pdf.uploadDescription')}</p>
            {selectedPdfName && <p className="mt-3 text-xs text-slate-400">{t('intake.pdf.selectedFile', { fileName: selectedPdfName })}</p>}
          </div>
          {pageSelection && (
            <div className="space-y-3 rounded-md border border-amber-300/20 bg-amber-400/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-amber-50">{t('intake.pdf.selectionTitle')}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/80">{t('intake.pdf.selectionDescription')}</p>
                </div>
                <Badge variant="outline" className="border-amber-300/30 bg-amber-400/10 text-amber-50">
                  {t(getPdfAnalysisLabelKey(pageSelection.analysis))}
                </Badge>
              </div>

              <p className="text-xs text-amber-100/80">{t('intake.pdf.pageCount', { count: pageSelection.analysis.pageCount })}</p>

              {pageSelection.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {pageSelection.warnings.map(warning => (
                    <div key={`${warning.code}-${warning.fieldPath || warning.message}`} className="flex gap-2 rounded-md border border-amber-300/20 bg-black/15 px-2 py-1.5 text-xs text-amber-50">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{formatIntakeWarningMessage(warning, t)}</span>
                    </div>
                  ))}
                </div>
              )}

              {pageSelection.analysis.signals.length > 0 && (
                <div className="space-y-1.5">
                  {pageSelection.analysis.signals.map(signal => (
                    <div key={signal.code} className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-300">
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

              <p className="text-xs text-amber-100/80">{t('intake.pdf.pageRangeHelper')}</p>

              <Button className="h-9 w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={handleGenerateFromSelectedPages} disabled={isBusy || !pdfFile}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                {t('actions.generateDraftFromPages')}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{t('intake.pdf.helper')}</p>
            <Button className="h-9 bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={handleChoosePdf} disabled={isBusy || Boolean(draft) || usage?.remainingAttempts === 0}>
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {selectedPdfName ? t('actions.chooseAnotherPdf') : t('actions.choosePdf')}
            </Button>
          </div>
          <IntakeStatusNotice mode="pdf" status={intakeStatus} fileName={selectedPdfName} />
          {error && <p className="rounded-md border border-rose-400/20 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">{error}</p>}
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
              pdfAnalysisTone === 'blocked' && 'border-rose-400/20 bg-rose-500/10',
              pdfAnalysisTone === 'review' && 'border-amber-300/20 bg-amber-400/10',
              pdfAnalysisTone === 'normal' && 'border-white/10 bg-black/20',
            )}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">{t('intake.review.analysisTitle')}</p>
                <Badge variant="outline" className={cn(
                  pdfAnalysisTone === 'blocked' && 'border-rose-300/25 bg-rose-500/10 text-rose-100',
                  pdfAnalysisTone === 'review' && 'border-amber-300/25 bg-amber-400/10 text-amber-100',
                  pdfAnalysisTone === 'normal' && 'border-white/10 bg-black/20 text-slate-300',
                )}>
                  {t(getPdfAnalysisLabelKey(pdfAnalysis))}
                </Badge>
              </div>

              <p className="text-xs text-slate-400">
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
                    <div key={signal.code} className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-300">
                      {signal.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-medium text-slate-100">{draft.resume.personal.fullName}</p>
            <p className="mt-1 text-xs text-slate-400">{draft.resume.personal.headline}</p>
            <p className="mt-2 line-clamp-3 text-xs text-slate-500">{draft.resume.summary}</p>
          </div>

          {draft.warnings.length > 0 && (
            <div className="space-y-1.5">
              {draft.warnings.map(warning => (
                <div key={`${warning.code}-${warning.fieldPath || warning.message}`} className="flex gap-2 rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-100">
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
            <Button className="h-9 flex-1 bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={handleApplyDraft}>
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
  onPasteText,
  onUploadPdf,
  onStartManually,
  onTailorLater,
}: {
  onDismiss?: () => void;
  onPasteText: () => void;
  onUploadPdf: () => void;
  onStartManually: () => void;
  onTailorLater?: () => void;
}) {
  const { t } = useI18n();
  const steps = ['start', 'edit', 'design', 'tailor', 'export'] as const;

  React.useEffect(() => {
    trackAnalyticsEvent('onboarding_viewed', { surface: 'start_tab' });
  }, []);

  const handleDismiss = () => {
    trackAnalyticsEvent('onboarding_dismissed', { surface: 'start_tab' });
    onDismiss?.();
  };

  return (
    <section className="space-y-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">{t('onboarding.eyebrow')}</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{t('onboarding.title')}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-300">{t('onboarding.description')}</p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-cyan-300/20 bg-black/20 px-2 py-1 text-[11px] leading-4 text-cyan-100">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('onboarding.localOnlyNote')}
          </p>
        </div>
        {onDismiss ? (
          <Button type="button" variant="outline" className="h-8 shrink-0 border-white/10 bg-white/[0.04] px-2 text-xs text-slate-200 hover:bg-white/[0.08]" onClick={handleDismiss}>
            {t('onboarding.dismiss')}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Button type="button" className="h-auto min-w-0 justify-start whitespace-normal bg-cyan-300 p-3 text-left text-slate-950 hover:bg-cyan-200" onClick={onUploadPdf}>
          <FileUp className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">{t('onboarding.actions.uploadPdf')}</span>
        </Button>
        <Button type="button" variant="outline" className="h-auto min-w-0 justify-start whitespace-normal border-white/10 bg-white/[0.04] p-3 text-left text-slate-100 hover:bg-white/[0.08]" onClick={onPasteText}>
          <FileText className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">{t('onboarding.actions.pasteText')}</span>
        </Button>
        <Button type="button" variant="outline" className="h-auto min-w-0 justify-start whitespace-normal border-white/10 bg-white/[0.04] p-3 text-left text-slate-100 hover:bg-white/[0.08]" onClick={onStartManually}>
          <PenLine className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">{t('onboarding.actions.startManually')}</span>
        </Button>
      </div>

      <div className="rounded border border-white/10 bg-black/20 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t('onboarding.workflowTitle')}</p>
        <ol className="mt-2 grid gap-1.5 text-xs text-slate-300 sm:grid-cols-5">
          {steps.map((step, index) => (
            <li key={step} className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
              <span className="text-cyan-200">{index + 1}.</span> {t(`onboarding.workflow.${step}`)}
            </li>
          ))}
        </ol>
      </div>

      <button type="button" className="text-left text-xs leading-5 text-slate-400 hover:text-slate-200" onClick={onTailorLater}>
        {t('onboarding.tailorLater')}
      </button>
    </section>
  );
}

function ContextHint({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-xs font-semibold text-slate-100">{title}</p>
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
        active ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-50' : 'border-white/10 bg-black/20 text-slate-300 hover:bg-white/[0.05]',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-black/20',
      )}
    >
      <Icon className="mb-2 h-4 w-4 text-cyan-200" />
      <span className="block text-xs font-semibold text-slate-100">{title}</span>
      <span className="mt-1 block text-[11px] leading-4 text-slate-500">{description}</span>
    </button>
  );
}

function DraftStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function IntakeStatusNotice({ mode, status, fileName }: { mode: StartIntakeMode; status: IntakeStatus; fileName?: string | null }) {
  const { t } = useI18n();

  const config = {
    idle: {
      icon: mode === 'pdf' ? FileUp : FileText,
      className: 'border-white/10 bg-black/20 text-slate-400',
      label: mode === 'pdf' ? t('intake.notices.idlePdf') : t('intake.notices.idleText'),
    },
    uploading: {
      icon: Loader2,
      className: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
      label: t('intake.notices.uploading', { fileName: fileName || t('common.pdf') }),
    },
    extracting: {
      icon: Loader2,
      className: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
      label: t('intake.notices.extracting'),
    },
    generating: {
      icon: Loader2,
      className: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
      label: mode === 'pdf' ? t('intake.notices.generatingPdf') : t('intake.notices.generatingText'),
    },
    needsSelection: {
      icon: AlertTriangle,
      className: 'border-amber-300/20 bg-amber-400/10 text-amber-100',
      label: t('intake.notices.selectionRequired'),
    },
    error: {
      icon: AlertTriangle,
      className: 'border-rose-400/20 bg-rose-500/10 text-rose-100',
      label: mode === 'pdf' ? t('intake.notices.errorPdf') : t('intake.notices.errorText'),
    },
    success: {
      icon: Check,
      className: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
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
      <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={Boolean(experience.current)}
          onChange={event => onUpdate({ current: event.target.checked, endDate: event.target.checked ? '' : experience.endDate })}
          className="h-3.5 w-3.5 accent-cyan-400"
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
            <Button size="icon" variant="ghost" title={t('actions.delete')} className="h-8 w-8 shrink-0 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" onClick={() => onChange(bullets.filter((_, index) => index !== bulletIndex))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-cyan-200 hover:bg-cyan-400/10 hover:text-cyan-100" onClick={() => onChange([...bullets, ''])}>
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
    <div className="overflow-hidden rounded-md border border-white/10 bg-black/20">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{title}</p>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>
        <Button size="icon" variant="ghost" title={t('actions.delete')} className="h-8 w-8 shrink-0 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" onClick={onRemove}>
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
                className={cn('flex h-9 items-center justify-center rounded-md border bg-black/20 transition', isActive ? 'border-white/70' : 'border-white/10 hover:border-white/30')}
              >
                <span className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: preset.value }} />
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
        isActive ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-50 shadow-lg shadow-cyan-950/20' : 'border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:bg-white/[0.05]',
      )}
    >
      <div className="grid gap-3 md:grid-cols-[170px_1fr] md:items-start">
        <div className={cn('overflow-hidden rounded-xl border bg-[#0b0b0a]', isActive ? 'border-cyan-200/30' : 'border-white/10')}>
          <div className="aspect-[4/3] bg-[#f3efe6]">
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
              <p className="mt-1 text-xs leading-5 text-slate-400">{t(template.descriptionKey)}</p>
            </div>
            {isActive ? (
              <Badge variant="outline" className="border-cyan-300/50 bg-cyan-300/10 text-cyan-100">
                <Check className="mr-1 h-3 w-3" />
                {t('common.current')}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-400">{t('common.select')}</Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
              {t(template.preview.layoutLabelKey)}
            </Badge>
            {template.preview.tagKeys.map(tagKey => (
              <Badge key={`${template.id}-${tagKey}`} variant="outline" className="border-white/10 bg-white/[0.03] text-slate-400">
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
    <div className="grid gap-1 rounded-md border border-white/10 bg-black/20 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
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
              isActive ? 'bg-white/12 text-white shadow-sm shadow-black/30' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
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
  const { resume, typstSource, documents, activeDocumentId } = useResumeGeneratorStore();
  const { t } = useI18n();
  const [exportStatus, setExportStatus] = React.useState<ExportStatus>('idle');
  const [lastExportFileName, setLastExportFileName] = React.useState<string | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
  const documentTitle = activeDocument?.title || resume.title;
  const activeTemplate = resumeTemplates.find(template => template.id === resolveTemplateId(resume.templateId)) || resumeTemplates[0];
  const readiness = getExportReadiness(resume);
  const pdfFileName = buildResumeExportFileName(resume, 'pdf', documentTitle);
  const typFileName = buildResumeExportFileName(resume, 'typ', documentTitle);
  const isDownloadingPdf = exportStatus === 'generating';

  const handleCopyTypst = async () => {
    try {
      await copyTypstSource(typstSource);
      toast.success(t('toast.copiedSource'));
    } catch (error) {
      toast.error(t('toast.copyFailed'), { description: formatError(error) });
    }
  };

  const handleDownloadTypst = () => {
    try {
      downloadTypstSource(typstSource, resume, documentTitle);
      toast.success(t('toast.typstDownloaded'));
    } catch (error) {
      toast.error(t('toast.downloadFailed'), { description: formatError(error) });
    }
  };

  const handleDownloadPdf = async () => {
    setExportStatus('generating');
    setExportError(null);
    trackAnalyticsEvent('export_started', {
      format: 'pdf',
      issueCodes: readiness.issues.map(issue => issue.code),
    });
    try {
      const result = await renderTypstToPdf(typstSource);
      if (!result.ok) {
        throw new Error(result.error || t('preview.pdfRenderFailed'));
      }

      const fileName = await exportPdf(resume, result.pdfBlob, documentTitle);
      setLastExportFileName(fileName);
      setExportStatus('success');
      trackAnalyticsEvent('export_completed', {
        format: 'pdf',
        issueCodes: readiness.issues.map(issue => issue.code),
      });
      toast.success(t('toast.pdfDownloaded'));
    } catch (error) {
      setExportStatus('error');
      setExportError(formatError(error));
      trackAnalyticsEvent('export_failed', {
        format: 'pdf',
        issueCodes: readiness.issues.map(issue => issue.code),
        reason: 'render_failed',
      });
      toast.error(t('toast.pdfDownloadFailed'), { description: formatError(error) });
    }
  };

  return (
    <ControlGroup title={t('sections.exportActions')} icon={FileDown} meta={t('meta.sourceChars', { count: typstSource.length.toLocaleString() })} defaultOpen>
      <div className="space-y-3">
        <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{t('exportPanel.summaryTitle')}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{t('exportPanel.summaryDescription')}</p>
            </div>
            <Badge className={readiness.status === 'ready' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}>
              {readiness.status === 'ready' ? t('exportPanel.ready') : t('exportPanel.checksWorthReviewing', { count: readiness.issues.length })}
            </Badge>
          </div>
          <div className="rounded border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2">
            <p className="text-sm font-semibold text-cyan-50">{t('exportPanel.activeDocumentTitle', { title: documentTitle })}</p>
            <p className="mt-1 text-xs leading-5 text-cyan-100/80">{t('exportPanel.activeDocumentDescription')}</p>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <ExportSummaryItem label={t('exportPanel.documentTitle')} value={documentTitle} />
            <ExportSummaryItem label={t('exportPanel.candidateName')} value={resume.personal.fullName || t('exportPanel.missingValue')} />
            <ExportSummaryItem label={t('exportPanel.template')} value={t(activeTemplate.nameKey)} />
            <ExportSummaryItem label={t('exportPanel.pageSize')} value={t(`design.pageSize.${resume.design.pageSize}.label`)} />
            <ExportSummaryItem label={t('exportPanel.lastUpdated')} value={activeDocument?.updatedAt ? formatExportDate(activeDocument.updatedAt) : t('exportPanel.missingValue')} />
            <ExportSummaryItem label={t('exportPanel.fileName')} value={pdfFileName} />
          </dl>
          {readiness.issues.length > 0 ? (
            <ul className="space-y-1.5 text-xs leading-5 text-amber-100/90">
              {readiness.issues.map(issue => (
                <li key={issue.code} className="flex gap-2 rounded border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t(getExportReadinessIssueLabelKey(issue.code))}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {exportStatus !== 'idle' ? (
          <div className={`rounded-md border px-3 py-2 text-xs ${exportStatus === 'success' ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100' : exportStatus === 'error' ? 'border-rose-400/20 bg-rose-500/10 text-rose-100' : 'border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100'}`}>
            {exportStatus === 'generating' ? t('exportPanel.generatingPdf') : exportStatus === 'success' ? t('exportPanel.exportedFile', { fileName: lastExportFileName || pdfFileName }) : t('exportPanel.exportFailed', { message: exportError || t('preview.pdfRenderFailed') })}
          </div>
        ) : null}

        <div className="grid gap-2">
          <Button className="h-auto min-h-10 justify-start whitespace-normal bg-cyan-300 text-left text-slate-950 hover:bg-cyan-200" onClick={handleDownloadPdf} disabled={isDownloadingPdf}>
            {isDownloadingPdf ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileDown className="h-4 w-4 shrink-0" />}
            <span className="min-w-0">{isDownloadingPdf ? t('exportPanel.generatingPdf') : t('actions.downloadPdf')}</span>
          </Button>
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

function ExportSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-200">{value}</dd>
    </div>
  );
}

function formatExportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function getExportReadinessIssueLabelKey(code: ExportReadinessIssueCode) {
  switch (code) {
    case 'missing_name':
      return 'exportPanel.readinessIssues.missingName';
    case 'missing_email':
      return 'exportPanel.readinessIssues.missingEmail';
    case 'empty_summary':
      return 'exportPanel.readinessIssues.emptySummary';
    case 'no_experience':
      return 'exportPanel.readinessIssues.noExperience';
    case 'no_education':
      return 'exportPanel.readinessIssues.noEducation';
    case 'no_skills':
      return 'exportPanel.readinessIssues.noSkills';
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
            <div key={version.id} className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">{version.label}</p>
                <p className="text-[11px] text-slate-500">{new Date(version.createdAt).toLocaleString()}</p>
              </div>
              <Button size="icon" variant="ghost" title={t('actions.restore')} className="h-8 w-8 text-slate-400 hover:bg-cyan-400/10 hover:text-cyan-200" onClick={() => restoreVersion(version)}>
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title={t('actions.delete')} className="h-8 w-8 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" onClick={() => deleteVersion(version.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </ControlGroup>
  );
}
