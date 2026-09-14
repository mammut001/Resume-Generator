import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCheck,
  CheckCircle2,
  Copy,
  FilePlus2,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n/useI18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { ResumeData, ResumeTailoringResult, ResumeTailoringSection, ResumeTailoringUsage } from '@/types/resume';
import { applyTailoringChanges } from '../lib/applyTailoringChanges';
import { formatError } from '../lib/formatError';
import { formatTailoringWarningMessage } from '../lib/formatTailoringWarning';
import { generateTailoredResume, getTailoringUsage } from '../lib/resumeTailoring';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const textareaClass = 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500';

type TailoringStatus = 'idle' | 'checking' | 'generating' | 'error' | 'success';

const sectionOrder: ResumeTailoringSection[] = ['summary', 'experience', 'skills', 'projects'];

export function computeAtsMatchScore(matchedCount: number, gapCount: number): number {
  return Math.round((matchedCount / Math.max(matchedCount + gapCount, 1)) * 100);
}

export function AtsScoreGauge({ score }: { score: number }) {
  const { t } = useI18n();
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * Math.min(Math.max(score, 0), 100)) / 100;

  const tone = score >= 75 ? 'emerald' : score >= 50 ? 'amber' : 'rose';

  const toneConfig = {
    emerald: {
      stroke: 'stroke-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-400',
    },
    amber: {
      stroke: 'stroke-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
    },
    rose: {
      stroke: 'stroke-rose-500',
      text: 'text-rose-600 dark:text-rose-400',
    },
  }[tone];

  return (
    <div
      data-testid="ats-score-gauge"
      data-score={score}
      className="flex flex-col items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80 sm:flex-row sm:gap-5"
    >
      <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
        <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r={radius}
            strokeWidth="8"
            className="stroke-slate-100 dark:stroke-slate-800"
            fill="none"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={cn('transition-all duration-1000 ease-out', toneConfig.stroke)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={cn('text-2xl font-extrabold tracking-tight', toneConfig.text)}>
            {score}%
          </span>
        </div>
      </div>
      <div className="mt-2 text-center sm:mt-0 sm:text-left">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('tailoring.matchScore')}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {score >= 75
            ? `${t('tailoring.matchedStrengths')} — ${score}%`
            : score >= 50
              ? `${t('tailoring.targetRole')} — ${score}%`
              : `${t('tailoring.gaps')} — ${score}%`}
        </p>
      </div>
    </div>
  );
}

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

  const handleAcceptAll = () => {
    if (!result) return;
    setAcceptedChangeIds(new Set(result.changes.map(change => change.id)));
  };

  const handleRejectAll = () => {
    setAcceptedChangeIds(new Set());
  };

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              {t('tailoring.title')}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('tailoring.description')}</p>
          </div>
          {usage ? (
            <Badge className="shrink-0 border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
              {t('tailoring.usage.remaining', { remaining: usage.remainingAttempts, limit: usage.limit })}
            </Badge>
          ) : null}
        </div>
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
          {t('tailoring.currentResume', { title: activeDocument?.title || resume.title })}
        </p>
        {usageLoadFailed ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">{t('tailoring.usage.loadFailed')}</p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tailoring.jobDescriptionLabel')}</Label>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('meta.characters', { count: jobDescription.length })}</span>
        </div>
        <Textarea
          className={`${textareaClass} min-h-[180px] resize-y text-sm leading-6`}
          value={jobDescription}
          onChange={event => setJobDescription(event.target.value)}
          placeholder={t('tailoring.jobDescriptionPlaceholder')}
        />
        <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t('tailoring.helper')}</p>
        {quotaExhausted ? (
          <div role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">{t('tailoring.usage.exhausted')}</div>
        ) : null}
        {error ? (
          <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>
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
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
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
  onAcceptAll,
  onRejectAll,
  onApply,
}: {
  result: ResumeTailoringResult;
  selectedResume: ResumeData;
  acceptedChangeIds: Set<string>;
  onChangeDecision: (changeId: string, accepted: boolean) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const acceptedCount = result.changes.filter(change => acceptedChangeIds.has(change.id)).length;
  const rejectedCount = result.changes.length - acceptedCount;

  const matched = result.summary.matchedStrengths || [];
  const gaps = result.summary.gaps || [];
  const score = computeAtsMatchScore(matched.length, gaps.length);

  const changesBySection = sectionOrder.map(section => ({
    section,
    changes: result.changes.filter(change => change.section === section),
  })).filter(group => group.changes.length > 0);

  return (
    <section className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-950/80 dark:bg-emerald-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            {t('tailoring.reviewTitle')}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('tailoring.reviewDescription')}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              {t('tailoring.acceptedCount', { count: acceptedCount })}
            </Badge>
            <Badge className="border-slate-500/30 bg-slate-500/10 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {t('tailoring.rejectedCount', { count: rejectedCount })}
            </Badge>
          </div>
          <Button type="button" className="bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500" disabled={acceptedCount === 0} onClick={onApply}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            {t('tailoring.applySelectedAsNewDocument')}
          </Button>
        </div>
      </div>

      {/* ATS Circular Donut Score Gauge */}
      <AtsScoreGauge score={score} />

      {/* Target Role & Key Requirements Glassmorphism Card */}
      <div className="space-y-3 rounded-xl border border-slate-200/80 bg-white/70 p-3.5 shadow-sm backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('tailoring.targetRole')}
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
              {result.summary.targetRole || t('tailoring.notDetected')}
            </p>
          </div>
          {result.summary.targetRole ? (
            <Badge className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300">
              {result.summary.targetRole}
            </Badge>
          ) : null}
        </div>

        {result.summary.keyRequirements.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('tailoring.keyRequirements')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.summary.keyRequirements.map(req => (
                <Badge
                  key={req}
                  variant="outline"
                  className="border-slate-200 bg-slate-100/80 text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 text-xs font-normal"
                >
                  {req}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('tailoring.noneFound')}</p>
        )}
      </div>

      {/* Dual-column Keyword Cloud / Matrix */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Matched Keywords */}
        <div className="space-y-2 rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-3 dark:border-emerald-950/60 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {t('tailoring.matchedStrengths')}
            </p>
            <Badge variant="outline" className="border-emerald-300 bg-emerald-100/60 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px]">
              {matched.length}
            </Badge>
          </div>
          {matched.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {matched.map(kw => (
                <Badge
                  key={kw}
                  variant="outline"
                  className="flex items-center gap-1.5 border-emerald-300 bg-white/80 text-emerald-800 dark:border-emerald-800/80 dark:bg-slate-900/90 dark:text-emerald-300 px-2.5 py-1 text-xs font-medium shadow-2xs"
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{kw}</span>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('tailoring.noneFound')}</p>
          )}
        </div>

        {/* Gaps with Quick-copy */}
        <div className="space-y-2 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 dark:border-amber-950/60 dark:bg-amber-950/20">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              {t('tailoring.gaps')}
            </p>
            <Badge variant="outline" className="border-amber-300 bg-amber-100/60 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
              {gaps.length}
            </Badge>
          </div>
          {gaps.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {gaps.map(gap => (
                <Badge
                  key={gap}
                  variant="outline"
                  className="group flex items-center gap-1.5 border-amber-300 bg-white/80 text-amber-900 dark:border-amber-800/80 dark:bg-slate-900/90 dark:text-amber-300 px-2.5 py-1 text-xs font-medium shadow-2xs"
                >
                  <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>{gap}</span>
                  <button
                    type="button"
                    data-testid={`copy-gap-${gap}`}
                    title={t('tailoring.copyKeyword')}
                    aria-label={`${t('tailoring.copyKeyword')}: ${gap}`}
                    onClick={async e => {
                      e.stopPropagation();
                      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(gap);
                      }
                      toast.success(`${t('tailoring.copyKeyword')}: ${gap}`);
                    }}
                    className="ml-0.5 rounded p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/60 transition"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('tailoring.noGaps')}</p>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tailoring.selectedDraftPreview')}</p>
        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{acceptedCount > 0 ? selectedResume.summary : t('tailoring.noAcceptedChanges')}</p>
      </div>

      {/* Proposed Changes with Accept All / Reject All */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tailoring.proposedChanges')}</p>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="accept-all-btn"
              className="h-7 border-emerald-200 px-2.5 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
              onClick={onAcceptAll}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              {t('tailoring.acceptAll')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="reject-all-btn"
              className="h-7 border-slate-200 px-2.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={onRejectAll}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              {t('tailoring.rejectAll')}
            </Button>
          </div>
        </div>

        {changesBySection.length > 0 ? changesBySection.map(group => (
          <div key={group.section} className="rounded-xl border border-slate-200 bg-white/60 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/60">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{t(`sections.${group.section}`)}</p>
              <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {group.changes.length}
              </Badge>
            </div>
            <ul className="space-y-2.5 text-xs leading-5">
              {group.changes.map(change => {
                const accepted = acceptedChangeIds.has(change.id);
                const kindBadgeClass = change.kind === 'removed'
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300'
                  : (change.kind === 'emphasized' || change.kind === 'added')
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300';

                return (
                  <li
                    key={change.id}
                    data-testid={`diff-card-${change.id}`}
                    className={`rounded-lg border p-3 transition-all ${
                      accepted
                        ? 'border-emerald-200 bg-white shadow-xs dark:border-emerald-900/80 dark:bg-slate-900'
                        : 'border-slate-200 bg-slate-50/60 opacity-80 dark:border-slate-800 dark:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <Badge variant="outline" className="text-[10px] font-medium border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            {t(`sections.${change.section}`)}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] font-medium ${kindBadgeClass}`}>
                            {t(`tailoring.changeKinds.${change.kind}`) || change.kind}
                          </Badge>
                        </div>
                        <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                          <span className="font-semibold">{t(`tailoring.changeKinds.${change.kind}`)}:</span> {change.description}
                        </p>
                        {change.reason ? (
                          <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                            {change.reason}
                          </p>
                        ) : null}

                        {change.before && change.after && change.before !== change.after ? (
                          <div className="mt-2 space-y-1 rounded border border-slate-200/80 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed dark:border-slate-800 dark:bg-slate-950/60">
                            <div className="flex items-start gap-1.5 text-rose-600 dark:text-rose-400">
                              <span className="font-bold select-none">-</span>
                              <span className="line-through">{change.before}</span>
                            </div>
                            <div className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-300">
                              <span className="font-bold select-none">+</span>
                              <span>{change.after}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 gap-1 sm:self-start">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={`h-7 border-emerald-200 px-2 text-[11px] ${
                            accepted
                              ? 'bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                              : 'bg-transparent text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50'
                          }`}
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
                          className={`h-7 border-slate-300 px-2 text-[11px] ${
                            !accepted
                              ? 'bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-700 dark:text-slate-100'
                              : 'bg-transparent text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800'
                          }`}
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
        )) : (
          <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            {t('tailoring.noChanges')}
          </p>
        )}
      </div>

      {result.warnings.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-950/80 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {t('tailoring.warnings')}
          </p>
          <ul className="space-y-1.5 text-xs leading-5 text-amber-800 dark:text-amber-300">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.requirement || index}`}>{formatTailoringWarningMessage(warning, t)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}