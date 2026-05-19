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

const TOKEN_STORAGE_KEY = 'resume-generator-observability-token';
const SETTINGS_STORAGE_KEY = 'resume-generator-observability-settings';
const DEFAULT_AUTO_REFRESH_SECONDS = '30';
const defaultEndpoint = (import.meta.env.VITE_RESUME_OBSERVABILITY_ENDPOINT || '/api/observability/summary').trim();

export function ObservabilityAdminPage() {
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
      setErrorMessage('Paste a bearer token before loading the summary.');
      return;
    }

    const parsedHours = parseHours(hours);
    if (parsedHours === null) {
      setStatus('error');
      setErrorMessage('Hours must be an integer between 1 and 168.');
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
      const nextSummary = await fetchObservabilitySummary({ endpoint, token, hours: parsedHours });
      setSummary(nextSummary);
      setLastLoadedAt(nextSummary.generatedAt);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load the observability summary.');
    } finally {
      requestInFlightRef.current = false;
      if (background) {
        setIsBackgroundRefreshing(false);
      }
    }
  }, [endpoint, token, hours]);

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
      setTokenUpdateMessage('Paste the current bearer token before changing it.');
      return;
    }

    const normalizedNextToken = nextToken.trim();
    const normalizedConfirmToken = confirmNextToken.trim();
    if (normalizedNextToken.length < 8 || normalizedNextToken.length > 128) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage('New admin token must be between 8 and 128 characters.');
      return;
    }

    if (/\s/.test(normalizedNextToken)) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage('New admin token must not contain spaces.');
      return;
    }

    if (normalizedNextToken !== normalizedConfirmToken) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage('New admin token and confirmation must match.');
      return;
    }

    if (normalizedNextToken === currentToken) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage('New admin token must be different from the current token.');
      return;
    }

    setTokenUpdateStatus('saving');
    setTokenUpdateMessage(null);

    try {
      const result = await rotateObservabilityAdminToken({
        endpoint,
        token: currentToken,
        newToken: normalizedNextToken,
      });

      setToken(normalizedNextToken);
      setNextToken('');
      setConfirmNextToken('');
      setTokenUpdateStatus('success');
      setTokenUpdateMessage(`Admin token updated at ${formatDateTime(result.tokenUpdatedAt)}. This page now uses the new token.`);
    } catch (error) {
      setTokenUpdateStatus('error');
      setTokenUpdateMessage(error instanceof Error ? error.message : 'Failed to update the admin token.');
    }
  }, [confirmNextToken, endpoint, nextToken, token]);

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
  const autoRefreshLabel = autoRefreshMs > 0 ? `Auto refresh every ${autoRefreshMs / 1000}s` : 'Auto refresh off';

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.15),_transparent_28%),linear-gradient(180deg,_#09111a_0%,_#0f1723_55%,_#060b10_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-3xl border border-cyan-500/20 bg-black/25 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <div className="flex flex-col gap-4 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                Read-only backend page
              </Badge>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">Backend Observability</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  Inspect OTLP exporter health, queue pressure, dropped-record behavior, and recent backend summary data without exposing the admin token in the frontend bundle.
                </p>
              </div>
            </div>

            <a
              href="/"
              className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to resume editor
            </a>
          </div>
        </header>

        <Card className="border-white/10 bg-black/25 shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl text-white">Session access</CardTitle>
            <CardDescription className="text-slate-400">
              Paste the summary endpoint and bearer token locally. The token is stored in session storage only and is never bundled into the app.
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
              <Field label="Summary endpoint">
                <Input
                  aria-label="Summary endpoint"
                  value={endpoint}
                  onChange={event => setEndpoint(event.target.value)}
                  placeholder="/api/observability/summary"
                  className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                />
              </Field>

              <Field label="Bearer token">
                <Input
                  aria-label="Bearer token"
                  type="password"
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  placeholder="Paste observability token"
                  className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                />
              </Field>

              <Field label="Hours">
                <Input
                  aria-label="Summary window hours"
                  type="number"
                  min={1}
                  max={168}
                  value={hours}
                  onChange={event => setHours(event.target.value)}
                  className="border-white/10 bg-slate-950/70 text-slate-100"
                />
              </Field>

              <Field label="Auto refresh seconds">
                <Input
                  aria-label="Auto refresh seconds"
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
                  Load summary
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                  onClick={() => setToken('')}
                >
                  Clear token
                </Button>
              </div>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                Read-only
              </Badge>
              <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-200">
                {autoRefreshLabel}
              </Badge>
              {isBackgroundRefreshing ? (
                <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Refreshing
                </Badge>
              ) : null}
              <span>Use a full backend URL when the frontend is served from a different origin.</span>
              {lastLoadedAt ? <span>Last loaded {formatDateTime(lastLoadedAt)}</span> : null}
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
                  <h2 className="text-sm font-semibold text-white">Change admin token</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Rotate the observability bearer token persisted by the backend. The current token in this page is used to authorize the change.
                  </p>
                </div>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-300">
                  Token rotation
                </Badge>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
                <Field label="New admin token">
                  <Input
                    aria-label="New admin token"
                    type="password"
                    value={nextToken}
                    onChange={event => setNextToken(event.target.value)}
                    placeholder="Enter a replacement token"
                    className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                  />
                </Field>

                <Field label="Confirm new admin token">
                  <Input
                    aria-label="Confirm new admin token"
                    type="password"
                    value={confirmNextToken}
                    onChange={event => setConfirmNextToken(event.target.value)}
                    placeholder="Re-enter the replacement token"
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
                    Change token
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Use a memorable but hard-to-guess value. After a successful change, the new token is stored into this page session automatically.
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
            title="Requests"
            value={summary ? formatInteger(summary.requests.total) : '—'}
            description={summary ? `${formatPercent(summary.requests.errorRate)} error rate` : 'Load a summary to inspect recent traffic.'}
            icon={<Activity className="h-4 w-4 text-cyan-200" />}
          />
          <MetricCard
            title="p95 latency"
            value={summary?.requests.p95DurationMs != null ? `${formatInteger(summary.requests.p95DurationMs)} ms` : '—'}
            description="Overall request latency for the selected window."
            icon={<Clock3 className="h-4 w-4 text-emerald-200" />}
          />
          <MetricCard
            title="Dropped OTLP logs"
            value={summary ? formatInteger(totalDropped) : '—'}
            description={summary ? `${formatInteger(otlp?.droppedOverflowLogRecords ?? 0)} overflow, ${formatInteger(otlp?.droppedFailedExportLogRecords ?? 0)} retry exhaustion` : 'Queue overflow and failed-export drops.'}
            icon={<Siren className="h-4 w-4 text-amber-200" />}
          />
          <MetricCard
            title="Queue pressure"
            value={otlp ? `${formatInteger(otlp.queueDepth)} / ${formatInteger(otlp.queueCapacity)}` : '—'}
            description={otlp ? `${queueUsage}% of queue capacity in use` : 'Visible when the backend OTLP sink is enabled.'}
            icon={<Waypoints className="h-4 w-4 text-fuchsia-200" />}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          <TrendCard
            title="Request volume trend"
            description="Recent request buckets for the selected window."
            ariaLabel="Request volume trend"
            points={requestTrend}
            accentColor="#22d3ee"
          />
          <TrendCard
            title="Error volume trend"
            description="Recent error counts from the same request buckets."
            ariaLabel="Error volume trend"
            points={errorTrend}
            accentColor="#fb7185"
          />
          <TrendCard
            title="Queue depth trend"
            description="Persisted OTLP queue snapshots from sqlite history."
            ariaLabel="Queue depth trend"
            points={queueDepthTrend}
            accentColor="#a78bfa"
            badge={otlp?.history?.samples?.length ? 'Persisted' : undefined}
          />
          <TrendCard
            title="Dropped logs trend"
            description="Per-sample dropped-record deltas from persisted OTLP history."
            ariaLabel="Dropped logs trend"
            points={droppedTrend}
            accentColor="#f59e0b"
            badge={otlp?.history?.samples?.length ? 'Persisted' : undefined}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.95fr)]">
          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldCheck className="h-5 w-5 text-cyan-200" />
                OTLP exporter diagnostics
              </CardTitle>
              <CardDescription className="text-slate-400">
                Live queue and retry state from the backend sink diagnostics, plus persisted history-backed trend signals.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {otlp ? (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                      <span>Queue usage</span>
                      <span>{formatInteger(otlp.queueDepth)} / {formatInteger(otlp.queueCapacity)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400" style={{ width: `${queueUsage}%` }} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoRow label="Drop policy" value={capitalize(otlp.dropPolicy)} />
                    <InfoRow label="In-flight export" value={otlp.inFlight ? 'Yes' : 'No'} />
                    <InfoRow label="Successful exports" value={formatInteger(otlp.successfulExports)} />
                    <InfoRow label="Failed exports" value={formatInteger(otlp.failedExports)} />
                    <InfoRow label="Retry count" value={formatInteger(otlp.retryCount)} />
                    <InfoRow label="Exported log records" value={formatInteger(otlp.exportedLogRecords)} />
                    <InfoRow label="Overflow drops" value={formatInteger(otlp.droppedOverflowLogRecords)} />
                    <InfoRow label="Failed-export drops" value={formatInteger(otlp.droppedFailedExportLogRecords)} />
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                    <InfoRow label="Last success" value={formatDateTime(otlp.lastSuccessAt)} />
                    <InfoRow label="Last error" value={formatDateTime(otlp.lastErrorAt)} />
                    <InfoRow label="History samples" value={formatInteger(otlp.history?.samples.length ?? 0)} />
                    <InfoRow label="Last error message" value={otlp.lastErrorMessage || '—'} multiline />
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="No OTLP diagnostics returned"
                  description="The summary endpoint loaded, but the backend did not report an active OTLP sink. Enable RESUME_OBSERVABILITY_OTLP_LOGS_ENDPOINT to populate this section."
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">Recent failure breakdown</CardTitle>
              <CardDescription className="text-slate-400">
                Grouped by route, status code, and structured error code for the selected window.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.recentFailures.length ? summary.recentFailures.map(failure => (
                <div key={`${failure.routeId}-${failure.statusCode}-${failure.errorCode || 'none'}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-100">{failure.statusCode}</Badge>
                    <span className="text-sm font-medium text-white">{failure.routeId}</span>
                    <span className="text-xs text-slate-400">{failure.errorCode || 'No error code'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>{formatInteger(failure.count)} occurrences</span>
                    <span>Last seen {formatDateTime(failure.lastOccurredAt)}</span>
                  </div>
                </div>
              )) : (
                <EmptyState title="No recent failures" description="Load a summary to inspect grouped backend failures." />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">Top routes</CardTitle>
              <CardDescription className="text-slate-400">Highest traffic routes for the selected window.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.topRoutes.length ? summary.topRoutes.map(route => (
                <ListRow
                  key={route.routeId}
                  label={route.routeId}
                  value={`${formatInteger(route.requestCount)} req`}
                  meta={`${formatPercent(route.errorRate)} errors`}
                />
              )) : (
                <EmptyState title="No route data yet" description="Route volume appears here after the first successful summary load." />
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">Event counts</CardTitle>
              <CardDescription className="text-slate-400">Most frequent domain events in the current window.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.eventCounts.length ? summary.eventCounts.slice(0, 8).map(event => (
                <ListRow key={event.eventName} label={event.eventName} value={formatInteger(event.count)} />
              )) : (
                <EmptyState title="No event data yet" description="Domain event counts appear here after the first successful summary load." />
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
}: {
  title: string;
  description: string;
  ariaLabel: string;
  points: TrendPoint[];
  accentColor: string;
  badge?: string;
}) {
  const latestValue = points.length ? points[points.length - 1]?.value || 0 : 0;
  const peakValue = points.length ? Math.max(...points.map(point => point.value)) : 0;

  return (
    <Card className="border-white/10 bg-black/20 shadow-xl shadow-black/20">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription className="text-slate-400">{title}</CardDescription>
            <CardTitle className="mt-2 text-3xl font-semibold text-white">{points.length ? formatInteger(latestValue) : '—'}</CardTitle>
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
              <span>Latest {formatInteger(latestValue)}</span>
              <span>Peak {formatInteger(peakValue)}</span>
            </div>
          </>
        ) : (
          <EmptyState title="No recent samples" description="Load a summary or wait for persisted exporter history to accumulate." />
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
}: {
  endpoint: string;
  token: string;
  hours: number;
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
    throw new Error(await readSummaryError(response));
  }

  return response.json();
}

async function rotateObservabilityAdminToken({
  endpoint,
  token,
  newToken,
}: {
  endpoint: string;
  token: string;
  newToken: string;
}): Promise<{ success: boolean; tokenUpdatedAt: string }> {
  const response = await fetch(buildAdminTokenUrl(endpoint), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    body: JSON.stringify({ newToken }),
  });

  if (!response.ok) {
    throw new Error(await readSummaryError(response));
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

function buildAdminTokenUrl(endpoint: string) {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(endpoint.trim() || defaultEndpoint, base);

  if (!url.pathname.endsWith('/summary')) {
    throw new Error('Summary endpoint must point to /api/observability/summary before changing the admin token.');
  }

  url.pathname = url.pathname.replace(/\/summary$/, '/admin/token');
  url.search = '';

  if (url.origin === base && url.protocol.startsWith('http')) {
    return url.pathname;
  }

  return url.toString();
}

async function readSummaryError(response: Response) {
  const payload = await response.json().catch(() => null);
  const error = payload?.error;

  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;

  return `Summary request failed with status ${response.status}.`;
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

function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
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
