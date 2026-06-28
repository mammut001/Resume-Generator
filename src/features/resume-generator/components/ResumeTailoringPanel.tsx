import React from 'react';
import { AlertTriangle, Check, FilePlus2, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n/useI18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import type { ResumeData, ResumeTailoringResult, ResumeTailoringSection, ResumeTailoringUsage } from '@/types/resume';
import { applyTailoringChanges } from '../lib/applyTailoringChanges';
import { formatError } from '../lib/formatError';
import { formatTailoringWarningMessage } from '../lib/formatTailoringWarning';
import { generateTailoredResume, getTailoringUsage } from '../lib/resumeTailoring';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const textareaClass = 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500';

type TailoringStatus = 'idle' | 'checking' | 'generating' | 'error' | 'success';

const sectionOrder: ResumeTailoringSection[] = ['summary', 'experience', 'skills', 'projects'];

export function ResumeTailoringPanel() {
  const {
    resume,
    documents,
    activeDocumentId,
    createDocumentFromResume,
  } = useResumeGeneratorStore();
  const { t } = useI18n();
  const [jobDescription, setJobDescription] = React.useState('');
  const [status, setStatus] = React.useState<TailoringStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [usage, setUsage] = React.useState<ResumeTailoringUsage | null>(null);
  const [usageLoadFailed, setUsageLoadFailed] = React.useState(false);
  const [result, setResult] = React.useState<ResumeTailoringResult | null>(null);
  const [acceptedChangeIds, setAcceptedChangeIds] = React.useState<Set<string>>(new Set());
  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
  const quotaExhausted = usage?.remainingAttempts === 0;
  const canGenerate = jobDescription.trim().length >= 40 && status !== 'generating' && !quotaExhausted;
  const selectedResume = result ? applyTailoringChanges(resume, result, acceptedChangeIds) : null;

  const refreshUsage = React.useCallback(async () => {
    try {
      const nextUsage = await getTailoringUsage();
      setUsage(nextUsage);
      setUsageLoadFailed(false);
    } catch {
      setUsageLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setStatus('checking');
    getTailoringUsage()
      .then(nextUsage => {
        if (!cancelled) {
          setUsage(nextUsage);
          setUsageLoadFailed(false);
          setStatus('idle');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsageLoadFailed(true);
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = async () => {
    if (!canGenerate) {
      setError(t('tailoring.minimumLengthError'));
      return;
    }

    setStatus('generating');
    setError(null);
    setResult(null);
    setAcceptedChangeIds(new Set());
    trackAnalyticsEvent('tailoring_started', { source: 'job_description' });

    try {
      const tailoredResult = await generateTailoredResume(resume, jobDescription.trim());
      setResult(tailoredResult);
      setAcceptedChangeIds(new Set(tailoredResult.changes.map(change => change.id)));
      setStatus('success');
      trackAnalyticsEvent('tailoring_completed', {
        warningCodes: tailoredResult.warnings.map(warning => warning.code),
        changeCount: tailoredResult.changes.length,
        gapCount: tailoredResult.summary.gaps.length,
      });
      setUsage(previous => previous ? { ...previous, remainingAttempts: Math.max(previous.remainingAttempts - 1, 0) } : previous);
    } catch (requestError) {
      setError(formatError(requestError, t));
      setStatus('error');
      await refreshUsage();
    }
  };

  const handleApply = () => {
    if (!result || !selectedResume || acceptedChangeIds.size === 0) return;

    const sourceTitle = activeDocument?.title || resume.title;
    const targetRole = result.summary.targetRole;
    const documentTitle = targetRole
      ? t('tailoring.documentTitleWithRole', { source: sourceTitle, targetRole })
      : t('tailoring.documentTitleFallback', { source: sourceTitle });

    createDocumentFromResume(documentTitle, selectedResume);
    trackAnalyticsEvent('tailoring_applied', {
      acceptedCount: acceptedChangeIds.size,
      rejectedCount: result.changes.length - acceptedChangeIds.size,
    });
    toast.success(t('toast.tailoredDraftApplied'));
  };

  const handleChangeDecision = (changeId: string, accepted: boolean) => {
    const change = result?.changes.find(candidate => candidate.id === changeId);
    if (!accepted && change && acceptedChangeIds.has(changeId)) {
      trackAnalyticsEvent('tailoring_change_rejected', {
        section: change.section,
        changeKind: change.kind,
      });
    }

    setAcceptedChangeIds(previous => {
      const next = new Set(previous);
      if (accepted) {
        next.add(changeId);
      } else {
        next.delete(changeId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-blue-600" />
              {t('tailoring.title')}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('tailoring.description')}</p>
          </div>
          {usage ? (
            <Badge className="shrink-0 border-blue-300 bg-blue-100 text-blue-700">
              {t('tailoring.usage.remaining', { remaining: usage.remainingAttempts, limit: usage.limit })}
            </Badge>
          ) : null}
        </div>
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
          {t('tailoring.currentResume', { title: activeDocument?.title || resume.title })}
        </p>
        {usageLoadFailed ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{t('tailoring.usage.loadFailed')}</p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('tailoring.jobDescriptionLabel')}</Label>
          <span className="text-[10px] text-slate-500">{t('meta.characters', { count: jobDescription.length })}</span>
        </div>
        <Textarea
          className={`${textareaClass} min-h-[180px] resize-y text-sm leading-6`}
          value={jobDescription}
          onChange={event => setJobDescription(event.target.value)}
          placeholder={t('tailoring.jobDescriptionPlaceholder')}
        />
        <p className="text-[11px] leading-4 text-slate-500">{t('tailoring.helper')}</p>
        {quotaExhausted ? (
          <div role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('tailoring.usage.exhausted')}</div>
        ) : null}
        {error ? (
          <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        ) : null}
        <Button type="button" className="app-primary-btn w-full" disabled={!canGenerate} onClick={handleGenerate}>
          {status === 'generating' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {status === 'generating' ? t('tailoring.generating') : t('tailoring.generate')}
        </Button>
      </section>

      {result && selectedResume ? (
        <TailoringReview
          result={result}
          selectedResume={selectedResume}
          acceptedChangeIds={acceptedChangeIds}
          onChangeDecision={handleChangeDecision}
          onApply={handleApply}
        />
      ) : null}
    </div>
  );
}

function TailoringReview({
  result,
  selectedResume,
  acceptedChangeIds,
  onChangeDecision,
  onApply,
}: {
  result: ResumeTailoringResult;
  selectedResume: ResumeData;
  acceptedChangeIds: Set<string>;
  onChangeDecision: (changeId: string, accepted: boolean) => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const acceptedCount = result.changes.filter(change => acceptedChangeIds.has(change.id)).length;
  const rejectedCount = result.changes.length - acceptedCount;
  const changesBySection = sectionOrder.map(section => ({
    section,
    changes: result.changes.filter(change => change.section === section),
  })).filter(group => group.changes.length > 0);

  return (
    <section className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Check className="h-4 w-4 text-emerald-600" />
            {t('tailoring.reviewTitle')}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t('tailoring.reviewDescription')}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
              {t('tailoring.acceptedCount', { count: acceptedCount })}
            </Badge>
            <Badge className="border-slate-500/30 bg-slate-500/10 text-slate-700">
              {t('tailoring.rejectedCount', { count: rejectedCount })}
            </Badge>
          </div>
          <Button type="button" className="bg-emerald-400 text-emerald-950 hover:bg-emerald-300" disabled={acceptedCount === 0} onClick={onApply}>
          <FilePlus2 className="mr-2 h-4 w-4" />
            {t('tailoring.applySelectedAsNewDocument')}
          </Button>
        </div>
      </div>

      <SummaryBlock title={t('tailoring.targetRole')} values={result.summary.targetRole ? [result.summary.targetRole] : []} empty={t('tailoring.notDetected')} />
      <SummaryBlock title={t('tailoring.keyRequirements')} values={result.summary.keyRequirements} empty={t('tailoring.noneFound')} />
      <SummaryBlock title={t('tailoring.matchedStrengths')} values={result.summary.matchedStrengths} empty={t('tailoring.noneFound')} />
      <SummaryBlock title={t('tailoring.gaps')} values={result.summary.gaps} empty={t('tailoring.noGaps')} tone="warning" />

      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('tailoring.selectedDraftPreview')}</p>
        <p className="text-xs leading-5 text-slate-600">{acceptedCount > 0 ? selectedResume.summary : t('tailoring.noAcceptedChanges')}</p>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('tailoring.proposedChanges')}</p>
        {changesBySection.length > 0 ? changesBySection.map(group => (
          <div key={group.section} className="rounded border border-slate-200 bg-slate-50 p-2.5">
            <p className="mb-2 text-xs font-semibold text-slate-700">{t(`sections.${group.section}`)}</p>
            <ul className="space-y-2 text-xs leading-5 text-slate-600">
              {group.changes.map(change => {
                const accepted = acceptedChangeIds.has(change.id);
                return (
                  <li key={change.id} className={`rounded border px-2 py-1.5 ${accepted ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <span className="font-medium text-slate-900">{t(`tailoring.changeKinds.${change.kind}`)}:</span> {change.description}
                        {change.reason ? <p className="mt-1 text-slate-500">{change.reason}</p> : null}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={`h-7 border-emerald-200 px-2 text-[11px] ${accepted ? 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300' : 'bg-transparent text-emerald-700 hover:bg-emerald-50'}`}
                          aria-pressed={accepted}
                          aria-label={t('tailoring.acceptChangeFor', { description: change.description })}
                          onClick={() => onChangeDecision(change.id, true)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t('tailoring.acceptChange')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={`h-7 border-slate-500/40 px-2 text-[11px] ${!accepted ? 'bg-slate-200 text-slate-950 hover:bg-white' : 'bg-transparent text-slate-600 hover:bg-slate-200'}`}
                          aria-pressed={!accepted}
                          aria-label={t('tailoring.rejectChangeFor', { description: change.description })}
                          onClick={() => onChangeDecision(change.id, false)}
                        >
                          <X className="h-3.5 w-3.5" />
                          {t('tailoring.rejectChange')}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )) : <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t('tailoring.noChanges')}</p>}
      </div>

      {result.warnings.length > 0 ? (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            {t('tailoring.warnings')}
          </p>
          <ul className="space-y-1.5 text-xs leading-5 text-amber-700">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.requirement || index}`}>{formatTailoringWarningMessage(warning, t)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SummaryBlock({ title, values, empty, tone = 'neutral' }: { title: string; values: string[]; empty: string; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map(value => (
            <Badge key={value} className={tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-100 text-slate-700'}>
              {value}
            </Badge>
          ))}
        </div>
      ) : <p className="text-xs text-slate-500">{empty}</p>}
    </div>
  );
}