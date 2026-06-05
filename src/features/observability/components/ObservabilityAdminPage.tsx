import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Siren,
  Waypoints,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n/useI18n';
import type { TranslationParams, TranslationKey } from '@/i18n';

type OtlpDropPolicy = 'oldest' | 'newest';

type OtlpDiagnosticHistorySample = {
  occurredAt: string;
  queueDepth: number;
  queueCapacity: number;
  dropPolicy: OtlpDropPolicy;
  inFlight: boolean;
  successfulExports: number;
  failedExports: number;
  exportedLogRecords: number;
  droppedLogRecords: number;
  droppedOverflowLogRecords: number;
  droppedFailedExportLogRecords: number;
  retryCount: number;
};

type OtlpDiagnostics = {
  queueDepth: number;
  queueCapacity: number;
  dropPolicy: OtlpDropPolicy;
  inFlight: boolean;
  successfulExports: number;
  failedExports: number;
  exportedLogRecords: number;
  droppedLogRecords: number;
  droppedOverflowLogRecords: number;
  droppedFailedExportLogRecords: number;
  retryCount: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastSuccessAt: string | null;
  history?: {
    samples: OtlpDiagnosticHistorySample[];
  };
};

type ObservabilitySummary = {
  generatedAt: string;
  windowHours: number;
  requests: {
    total: number;
    errorCount: number;
    errorRate: number;
    p95DurationMs: number | null;
    recentCounts: Array<{
      bucketStart: string;
      requestCount: number;
      errorCount: number;
    }>;
  };
  recentFailures: Array<{
    routeId: string;
    statusCode: number;
    errorCode: string | null;
    count: number;
    lastOccurredAt: string;
  }>;
  topRoutes: Array<{
    routeId: string;
    requestCount: number;
    errorCount: number;
    errorRate: number;
  }>;
  topIpHashes: Array<{
    ipHash: string;
    requestCount: number;
    errorCount: number;
  }>;
  eventCounts: Array<{
    eventName: string;
    count: number;
  }>;
  sinks?: {
    otlp?: OtlpDiagnostics;
  };
};

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';
type TokenUpdateStatus = 'idle' | 'saving' | 'success' | 'error';

type TrendPoint = {
  label: string;
  value: number;
};

type StoredSettings = {
  endpoint: string;
  hours: string;
  autoRefreshSeconds: string;
};

type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

const TOKEN_STORAGE_KEY = 'resume-generator-observability-token';
const SETTINGS_STORAGE_KEY = 'resume-generator-observability-settings';
const DEFAULT_AUTO_REFRESH_SECONDS = '30';
const defaultEndpoint = (import.meta.env.VITE_RESUME_OBSERVABILITY_ENDPOINT || '/api/observability/summary').trim();

export function ObservabilityAdminPage() {
  const { t, locale } = useI18n();
  const bcp47: string = locale === 'zh-CN' ? 'zh-CN' : 'en-US';

  const storedSettings = React.useMemo(readStoredSettings, []);
  const storedToken = React.useMemo(readStoredToken, []);
  const [endpoint, setEndpoint] = React.useState(storedSettings.endpoint || defaultEndpoint);
  const [token, setToken] = React.useState(storedToken);
  const [hours, setHours] = React.useState(storedSettings.hours || '24');
  const [autoRefreshSeconds, setAutoRefreshSeconds] = React.useState(storedSettings.autoRefreshSeconds || DEFAULT_AUTO_REFRESH_SECONDS);
  const [status, setStatus] = React.useState<LoadStatus>('idle');
  const [tokenUpdateStatus, setTokenUpdateStatus] = React.useState<TokenUpdateStatus>('idle');
  const [tokenUpdateMessage, setTokenUpdateMessage] = React.useState<string | null>(null);
  const [nextToken, setNextToken] = React.useState('');
  const [confirmNextToken, setConfirmNextToken] = React.useState('');
  const [summary, setSummary] = React.useState<ObservabilitySummary | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<string | null>(null);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = React.useState(false);
  const requestInFlightRef = React.useRef(false);
  const hasAutoLoadedRef = React.useRef(false);

  React.useEffect(() => {
    writeStoredSettings({ endpoint, hours, autoRefreshSeconds });
  }, [endpoint, hours, autoRefreshSeconds]);

  React.useEffect(() => {
    writeStoredToken(token);
  }, [token]);

  const refreshSummary = React.useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (requestInFlightRef.current) {
      return;
    }

    if (!token.trim()) {
      setStatus('error');
      setErrorMessage(t('observability.session.errorTokenRequired'));
      return;
    }

    const parsedHours = parseHours(hours);
    if (parsedHours === null) {
      setStatus('error');
      setErrorMessage(t('observability.session.errorHoursRange'));
      return;
    }

    requestInFlightRef.current = true;

    if (background) {
      setIsBackgroundRefreshing(true);
    } else {
      setStatus('loading');
    }

    setErrorMessage(null);

    try {
      const nextSummary = await fetchObservabilitySummary({ endpoint, token, hours: parsedHours, t });
      setSummary(nextSummary);
      setLastLoadedAt(nextSummary.generatedAt);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('observability.session.errorLoadFailed'));
    } finally {
      requestInFlightRef.current = false;
      if (background) {
        setIsBackgroundRefreshing(false);
      }
    }
  }, [endpoint, hours, t, token]);

  React.useEffect(() => {
    if (!storedToken.trim() || hasAutoLoadedRef.current) {
      return;
    }

    hasAutoLoadedRef.current = true;
    void refreshSummary();
  }, [refreshSummary, storedToken]);

  const autoRefreshMs = parseAutoRefreshMilliseconds(autoRefreshSeconds);

  React.useEffect(() => {
    if (!token.trim() || autoRefreshMs <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshSummary({ background: true });
    }, autoRefreshMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoRefreshMs, refreshSummary, token]);

  const rotateAdminToken = React.useCallback(async () => {
    const currentToken = token.trim();
    if (!currentToken) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(t('observability.token.errorCurrentRequired'));
      return;
    }

    const normalizedNextToken = nextToken.trim();
    const normalizedConfirmToken = confirmNextToken.trim();
    if (normalizedNextToken.length < 8 || normalizedNextToken.length > 128) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(t('observability.token.errorLength'));
      return;
    }

    if (/\s/.test(normalizedNextToken)) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(t('observability.token.errorWhitespace'));
      return;
    }

    if (normalizedNextToken !== normalizedConfirmToken) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(t('observability.token.errorMismatch'));
      return;
    }

    if (normalizedNextToken === currentToken) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(t('observability.token.errorSameAsCurrent'));
      return;
    }

    setTokenUpdateStatus('saving');
    setTokenUpdateMessage(null);

    try {
      const result = await rotateObservabilityAdminToken({
        endpoint,
        token: currentToken,
        newToken: normalizedNextToken,
        t,
      });

      setToken(normalizedNextToken);
      setNextToken('');
      setConfirmNextToken('');
      setTokenUpdateStatus('success');
      setTokenUpdateMessage(t('observability.token.successMessage', { time: formatDateTime(result.tokenUpdatedAt, bcp47) }));
    } catch (error) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(error instanceof Error ? error.message : t('observability.token.errorUpdateFailed'));
    }
  }, [bcp47, confirmNextToken, endpoint, nextToken, t, token]);

  const otlp = summary?.sinks?.otlp;
  const totalDropped = otlp?.droppedLogRecords ?? 0;
  const queueUsage = otlp && otlp.queueCapacity > 0 ? Math.min(100, Math.round((otlp.queueDepth / otlp.queueCapacity) * 100)) : 0;
  const requestTrend = summary?.requests.recentCounts.map(bucket => ({
    label: bucket.bucketStart,
    value: bucket.requestCount,
  })) || [];
  const errorTrend = summary?.requests.recentCounts.map(bucket => ({
    label: bucket.bucketStart,
    value: bucket.errorCount,
  })) || [];
  const queueDepthTrend = otlp?.history?.samples.map(sample => ({
    label: sample.occurredAt,
    value: sample.queueDepth,
  })) || [];
  const droppedTrend = buildDeltaTrendPoints(otlp?.history?.samples || [], sample => sample.droppedLogRecords);
  const autoRefreshLabel = autoRefreshMs > 0
    ? t('observability.session.autoRefreshOn', { seconds: String(autoRefreshMs / 1000) })
    : t('observability.session.autoRefreshOff');
  const lastLoadedLabel = lastLoadedAt
    ? t('observability.session.lastLoaded', { time: formatDateTime(lastLoadedAt, bcp47) })
    : null;
  const emptyMarker = t('observability.values.empty');

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.15),_transparent_28%),linear-gradient(180deg,_#09111a_0%,_#0f1723_55%,_#060b10_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-3xl border border-cyan-500/20 bg-black/25 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <div className="flex flex-col gap-4 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                {t('observability.eyebrow')}
              </Badge>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">{t('observability.title')}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  {t('observability.description')}
                </p>
              </div>
            </div>

            <a
              href="/"
              className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('observability.backToEditor')}
            </a>
          </div>
        </header>

        <Card className="border-white/10 bg-black/25 shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl text-white">{t('observability.session.title')}</CardTitle>
            <CardDescription className="text-slate-400">
              {t('observability.session.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_120px_140px_auto] xl:items-end"
              onSubmit={event => {
                event.preventDefault();
                void refreshSummary();
              }}
            >
              <Field label={t('observability.session.endpointLabel')}>
                <Input
                  aria-label={t('observability.session.endpointLabel')}
                  value={endpoint}
                  onChange={event => setEndpoint(event.target.value)}
                  placeholder={t('observability.session.endpointPlaceholder')}
                  className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                />
              </Field>

              <Field label={t('observability.session.bearerTokenLabel')}>
                <Input
                  aria-label={t('observability.session.bearerTokenLabel')}
                  type="password"
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  placeholder={t('observability.session.bearerTokenPlaceholder')}
                  className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                />
              </Field>

              <Field label={t('observability.session.hoursLabel')}>
                <Input
                  aria-label={t('observability.session.hoursLabel')}
                  type="number"
                  min={1}
                  max={168}
                  value={hours}
                  onChange={event => setHours(event.target.value)}
                  className="border-white/10 bg-slate-950/70 text-slate-100"
                />
              </Field>

              <Field label={t('observability.session.autoRefreshLabel')}>
                <Input
                  aria-label={t('observability.session.autoRefreshLabel')}
                  type="number"
                  min={0}
                  max={3600}
                  value={autoRefreshSeconds}
                  onChange={event => setAutoRefreshSeconds(event.target.value)}
                  className="border-white/10 bg-slate-950/70 text-slate-100"
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={status === 'loading'} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                  {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t('observability.session.loadSummary')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                  onClick={() => setToken('')}
                >
                  {t('observability.session.clearToken')}
                </Button>
              </div>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                {t('observability.session.readOnlyBadge')}
              </Badge>
              <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-200">
                {autoRefreshLabel}
              </Badge>
              {isBackgroundRefreshing ? (
                <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  {t('observability.session.refreshingBadge')}
                </Badge>
              ) : null}
              <span>{t('observability.session.crossOriginHint')}</span>
              {lastLoadedLabel ? <span>{lastLoadedLabel}</span> : null}
            </div>

            {errorMessage ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            ) : null}

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">{t('observability.token.title')}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {t('observability.token.description')}
                  </p>
                </div>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-300">
                  {t('observability.token.rotationBadge')}
                </Badge>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
                <Field label={t('observability.token.newTokenLabel')}>
                  <Input
                    aria-label={t('observability.token.newTokenLabel')}
                    type="password"
                    value={nextToken}
                    onChange={event => setNextToken(event.target.value)}
                    placeholder={t('observability.token.newTokenPlaceholder')}
                    className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                  />
                </Field>

                <Field label={t('observability.token.confirmTokenLabel')}>
                  <Input
                    aria-label={t('observability.token.confirmTokenLabel')}
                    type="password"
                    value={confirmNextToken}
                    onChange={event => setConfirmNextToken(event.target.value)}
                    placeholder={t('observability.token.confirmTokenPlaceholder')}
                    className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                  />
                </Field>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => void rotateAdminToken()}
                    disabled={tokenUpdateStatus === 'saving'}
                    className="bg-amber-400 text-slate-950 hover:bg-amber-300"
                  >
                    {tokenUpdateStatus === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {t('observability.token.changeButton')}
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                {t('observability.token.helperHint')}
              </p>

              {tokenUpdateMessage ? (
                <div className={tokenUpdateStatus === 'success'
                  ? 'mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100'
                  : 'mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'}>
                  <p>{tokenUpdateMessage}</p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title={t('observability.metrics.requestsTitle')}
            value={summary ? formatInteger(summary.requests.total, bcp47) : emptyMarker}
            description={summary
              ? t('observability.metrics.requestsDescription', { percent: formatPercent(summary.requests.errorRate) })
              : t('observability.metrics.requestsDescriptionHint')}
            icon={<Activity className="h-4 w-4 text-cyan-200" />}
          />
          <MetricCard
            title={t('observability.metrics.p95Title')}
            value={summary?.requests.p95DurationMs != null ? `${formatInteger(summary.requests.p95DurationMs, bcp47)} ms` : emptyMarker}
            description={t('observability.metrics.p95Description')}
            icon={<Clock3 className="h-4 w-4 text-emerald-200" />}
          />
          <MetricCard
            title={t('observability.metrics.droppedTitle')}
            value={summary ? formatInteger(totalDropped, bcp47) : emptyMarker}
            description={summary
              ? t('observability.metrics.droppedBreakdown', {
                  overflow: formatInteger(otlp?.droppedOverflowLogRecords ?? 0, bcp47),
                  retry: formatInteger(otlp?.droppedFailedExportLogRecords ?? 0, bcp47),
                })
              : t('observability.metrics.droppedDescription')}
            icon={<Siren className="h-4 w-4 text-amber-200" />}
          />
          <MetricCard
            title={t('observability.metrics.queueTitle')}
            value={otlp ? `${formatInteger(otlp.queueDepth, bcp47)} / ${formatInteger(otlp.queueCapacity, bcp47)}` : emptyMarker}
            description={otlp
              ? t('observability.metrics.queueUsageDescription', { percent: String(queueUsage) })
              : t('observability.metrics.queueDescription')}
            icon={<Waypoints className="h-4 w-4 text-fuchsia-200" />}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          <TrendCard
            title={t('observability.trends.requestsTitle')}
            description={t('observability.trends.requestsDescription')}
            ariaLabel={t('observability.trends.requestsTitle')}
            points={requestTrend}
            accentColor="#22d3ee"
            t={t}
            bcp47={bcp47}
          />
          <TrendCard
            title={t('observability.trends.errorsTitle')}
            description={t('observability.trends.errorsDescription')}
            ariaLabel={t('observability.trends.errorsTitle')}
            points={errorTrend}
            accentColor="#fb7185"
            t={t}
            bcp47={bcp47}
          />
          <TrendCard
            title={t('observability.trends.queueTitle')}
            description={t('observability.trends.queueDescription')}
            ariaLabel={t('observability.trends.queueTitle')}
            points={queueDepthTrend}
            accentColor="#a78bfa"
            badge={otlp?.history?.samples?.length ? t('observability.trends.persistedBadge') : undefined}
            t={t}
            bcp47={bcp47}
          />
          <TrendCard
            title={t('observability.trends.droppedTitle')}
            description={t('observability.trends.droppedDescription')}
            ariaLabel={t('observability.trends.droppedTitle')}
            points={droppedTrend}
            accentColor="#f59e0b"
            badge={otlp?.history?.samples?.length ? t('observability.trends.persistedBadge') : undefined}
            t={t}
            bcp47={bcp47}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.95fr)]">
          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldCheck className="h-5 w-5 text-cyan-200" />
                {t('observability.otlp.title')}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t('observability.otlp.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {otlp ? (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                      <span>{t('observability.otlp.queueUsage')}</span>
                      <span>{formatInteger(otlp.queueDepth, bcp47)} / {formatInteger(otlp.queueCapacity, bcp47)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400" style={{ width: `${queueUsage}%` }} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoRow label={t('observability.otlp.dropPolicy')} value={capitalize(otlp.dropPolicy)} />
                    <InfoRow label={t('observability.otlp.inFlightLabel')} value={otlp.inFlight ? t('observability.otlp.inFlightYes') : t('observability.otlp.inFlightNo')} />
                    <InfoRow label={t('observability.otlp.successfulExports')} value={formatInteger(otlp.successfulExports, bcp47)} />
                    <InfoRow label={t('observability.otlp.failedExports')} value={formatInteger(otlp.failedExports, bcp47)} />
                    <InfoRow label={t('observability.otlp.retryCount')} value={formatInteger(otlp.retryCount, bcp47)} />
                    <InfoRow label={t('observability.otlp.exportedLogRecords')} value={formatInteger(otlp.exportedLogRecords, bcp47)} />
                    <InfoRow label={t('observability.otlp.overflowDrops')} value={formatInteger(otlp.droppedOverflowLogRecords, bcp47)} />
                    <InfoRow label={t('observability.otlp.failedExportDrops')} value={formatInteger(otlp.droppedFailedExportLogRecords, bcp47)} />
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                    <InfoRow label={t('observability.otlp.lastSuccess')} value={formatDateTime(otlp.lastSuccessAt, bcp47)} />
                    <InfoRow label={t('observability.otlp.lastError')} value={formatDateTime(otlp.lastErrorAt, bcp47)} />
                    <InfoRow label={t('observability.otlp.historySamples')} value={formatInteger(otlp.history?.samples.length ?? 0, bcp47)} />
                    <InfoRow label={t('observability.otlp.lastErrorMessage')} value={otlp.lastErrorMessage || emptyMarker} multiline />
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={t('observability.otlp.emptyTitle')}
                  description={t('observability.otlp.emptyDescription')}
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">{t('observability.failures.title')}</CardTitle>
              <CardDescription className="text-slate-400">
                {t('observability.failures.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.recentFailures.length ? summary.recentFailures.map(failure => (
                <div key={`${failure.routeId}-${failure.statusCode}-${failure.errorCode || 'none'}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-100">{failure.statusCode}</Badge>
                    <span className="text-sm font-medium text-white">{failure.routeId}</span>
                    <span className="text-xs text-slate-400">{failure.errorCode || t('observability.failures.noErrorCode')}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>{t('observability.failures.occurrences', { count: formatInteger(failure.count, bcp47) })}</span>
                    <span>{t('observability.failures.lastSeen', { time: formatDateTime(failure.lastOccurredAt, bcp47) })}</span>
                  </div>
                </div>
              )) : (
                <EmptyState title={t('observability.failures.emptyTitle')} description={t('observability.failures.emptyDescription')} />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">{t('observability.routes.title')}</CardTitle>
              <CardDescription className="text-slate-400">{t('observability.routes.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.topRoutes.length ? summary.topRoutes.map(route => (
                <ListRow
                  key={route.routeId}
                  label={route.routeId}
                  value={t('observability.routes.requests', { count: formatInteger(route.requestCount, bcp47) })}
                  meta={t('observability.routes.errors', { percent: formatPercent(route.errorRate) })}
                />
              )) : (
                <EmptyState title={t('observability.routes.emptyTitle')} description={t('observability.routes.emptyDescription')} />
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">{t('observability.events.title')}</CardTitle>
              <CardDescription className="text-slate-400">{t('observability.events.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.eventCounts.length ? summary.eventCounts.slice(0, 8).map(event => (
                <ListRow key={event.eventName} label={event.eventName} value={formatInteger(event.count, bcp47)} />
              )) : (
                <EmptyState title={t('observability.events.emptyTitle')} description={t('observability.events.emptyDescription')} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardDescription className="text-slate-400">{title}</CardDescription>
          <div className="rounded-full border border-white/10 bg-white/5 p-2">{icon}</div>
        </div>
        <CardTitle className="text-3xl font-semibold text-white">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-400">{description}</p>
      </CardContent>
    </Card>
  );
}

function TrendCard({
  title,
  description,
  ariaLabel,
  points,
  accentColor,
  badge,
  t,
  bcp47,
}: {
  title: string;
  description: string;
  ariaLabel: string;
  points: TrendPoint[];
  accentColor: string;
  badge?: string;
  t: TFunction;
  bcp47: string;
}) {
  const latestValue = points.length ? points[points.length - 1]?.value || 0 : 0;
  const peakValue = points.length ? Math.max(...points.map(point => point.value)) : 0;

  return (
    <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription className="text-slate-400">{title}</CardDescription>
            <CardTitle className="mt-2 text-3xl font-semibold text-white">{points.length ? formatInteger(latestValue, bcp47) : '—'}</CardTitle>
          </div>
          {badge ? <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">{badge}</Badge> : null}
        </div>
        <p className="text-sm text-slate-400">{description}</p>
      </CardHeader>
      <CardContent>
        {points.length ? (
          <>
            <Sparkline ariaLabel={ariaLabel} points={points} accentColor={accentColor} />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>{t('observability.trends.latest', { value: formatInteger(latestValue, bcp47) })}</span>
              <span>{t('observability.trends.peak', { value: formatInteger(peakValue, bcp47) })}</span>
            </div>
          </>
        ) : (
          <EmptyState title={t('observability.trends.emptyTitle')} description={t('observability.trends.emptyDescription')} />
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({
  ariaLabel,
  points,
  accentColor,
}: {
  ariaLabel: string;
  points: TrendPoint[];
  accentColor: string;
}) {
  const width = 280;
  const height = 92;
  const padding = 8;
  const safePoints = points.length ? points : [{ label: 'empty', value: 0 }];
  const values = safePoints.map(point => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const coordinates = safePoints.map((point, index) => {
    const x = padding + (index * (width - (padding * 2))) / Math.max(safePoints.length - 1, 1);
    const y = height - padding - (((point.value - minimum) / range) * (height - (padding * 2)));
    return { x, y };
  });
  const path = coordinates.map(point => `${point.x},${point.y}`).join(' ');
  const areaPath = [
    `${coordinates[0]?.x ?? padding},${height - padding}`,
    path,
    `${coordinates[coordinates.length - 1]?.x ?? width - padding},${height - padding}`,
  ].join(' ');
  const lastPoint = coordinates[coordinates.length - 1];

  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible rounded-2xl border border-white/10 bg-white/[0.02] p-2">
      <polyline fill="rgba(255,255,255,0.02)" stroke="none" points={areaPath} />
      <polyline fill="none" stroke={accentColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={path} />
      {lastPoint ? <circle cx={lastPoint.x} cy={lastPoint.y} r="4" fill={accentColor} /> : null}
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className={multiline ? 'break-words text-sm text-slate-200' : 'text-sm text-slate-200'}>{value}</span>
    </div>
  );
}

function ListRow({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{label}</p>
        {meta ? <p className="mt-1 text-xs text-slate-400">{meta}</p> : null}
      </div>
      <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">{value}</Badge>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-5">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </div>
  );
}

async function fetchObservabilitySummary({
  endpoint,
  token,
  hours,
  t,
}: {
  endpoint: string;
  token: string;
  hours: number;
  t: TFunction;
}): Promise<ObservabilitySummary> {
  const url = buildSummaryUrl(endpoint, hours);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
  });

  if (!response.ok) {
    const fallback = t('observability.summaryError.failedPrefix', { status: String(response.status) });
    throw new Error(await readSummaryError(response, fallback));
  }

  return response.json();
}

async function rotateObservabilityAdminToken({
  endpoint,
  token,
  newToken,
  t,
}: {
  endpoint: string;
  token: string;
  newToken: string;
  t: TFunction;
}): Promise<{ success: boolean; tokenUpdatedAt: string }> {
  const response = await fetch(buildAdminTokenUrl(endpoint, t), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    body: JSON.stringify({ newToken }),
  });

  if (!response.ok) {
    const fallback = t('observability.summaryError.failedPrefix', { status: String(response.status) });
    throw new Error(await readSummaryError(response, fallback));
  }

  return response.json();
}

function buildSummaryUrl(endpoint: string, hours: number) {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(endpoint.trim() || defaultEndpoint, base);
  url.searchParams.set('hours', `${hours}`);

  if (url.origin === base && url.protocol.startsWith('http')) {
    return `${url.pathname}${url.search}`;
  }

  return url.toString();
}

function buildAdminTokenUrl(endpoint: string, t: TFunction) {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(endpoint.trim() || defaultEndpoint, base);

  if (!url.pathname.endsWith('/summary')) {
    throw new Error(t('observability.summaryError.invalidEndpoint'));
  }

  url.pathname = url.pathname.replace(/\/summary$/, '/admin/token');
  url.search = '';

  if (url.origin === base && url.protocol.startsWith('http')) {
    return url.pathname;
  }

  return url.toString();
}

async function readSummaryError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  const error = payload?.error;

  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;

  return fallbackMessage;
}

function readStoredSettings(): StoredSettings {
  try {
    const raw = window.sessionStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { endpoint: '', hours: '', autoRefreshSeconds: '' };
    }

    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      hours: typeof parsed.hours === 'string' ? parsed.hours : '',
      autoRefreshSeconds: typeof parsed.autoRefreshSeconds === 'string' ? parsed.autoRefreshSeconds : '',
    };
  } catch {
    return { endpoint: '', hours: '', autoRefreshSeconds: '' };
  }
}

function writeStoredSettings(settings: StoredSettings) {
  try {
    window.sessionStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore session storage write failures.
  }
}

function readStoredToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeStoredToken(token: string) {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      return;
    }

    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore session storage write failures.
  }
}

function parseHours(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 168) {
    return null;
  }

  return parsed;
}

function parseAutoRefreshMilliseconds(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed * 1000;
}

function buildDeltaTrendPoints(
  samples: OtlpDiagnosticHistorySample[],
  selectValue: (sample: OtlpDiagnosticHistorySample) => number,
): TrendPoint[] {
  return samples.map((sample, index) => {
    const previousValue = index === 0 ? 0 : selectValue(samples[index - 1] as OtlpDiagnosticHistorySample);
    return {
      label: sample.occurredAt,
      value: Math.max(0, selectValue(sample) - previousValue),
    };
  });
}

function formatInteger(value: number, bcp47: string) {
  return new Intl.NumberFormat(bcp47).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function formatDateTime(value: string | null, bcp47: string) {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat(bcp47, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
