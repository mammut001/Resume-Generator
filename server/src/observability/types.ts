export type RouteId =
  | 'health'
  | 'observability_summary'
  | 'observability_admin_token'
  | 'render_typst'
  | 'intake_usage'
  | 'intake_text'
  | 'intake_pdf'
  | 'tailor_usage'
  | 'tailor_resume'
  | 'not_found';

export type ObservabilityValue = string | number | boolean | string[] | number[] | null;

export type DomainEventPayload = Record<string, ObservabilityValue>;

export type RequestObservation = {
  occurredAt: string;
  requestId: string;
  routeId: RouteId;
  method: string;
  statusCode: number;
  durationMs: number;
  requestBytes: number | null;
  responseBytes: number | null;
  origin: string | null;
  contentType: string | null;
  ipHash: string | null;
  networkHash: string | null;
  userAgentFamily: string | null;
  errorCode: string | null;
};

export type DomainEvent = {
  occurredAt: string;
  requestId: string;
  routeId: RouteId;
  eventName: string;
  payload: DomainEventPayload;
};

export type OtlpDropPolicy = 'oldest' | 'newest';

export type OtlpDiagnosticHistorySample = {
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

export type OtlpExportDiagnostics = {
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
};

export type OtlpDiagnosticsSummary = OtlpExportDiagnostics & {
  history?: {
    samples: OtlpDiagnosticHistorySample[];
  };
};

export type ObservabilityDiagnostics = {
  otlp?: OtlpExportDiagnostics;
};

export type ObservabilitySink = {
  recordRequest: (observation: RequestObservation) => void | Promise<void>;
  recordEvent: (event: DomainEvent) => void | Promise<void>;
  getDiagnostics?: () => ObservabilityDiagnostics;
  close?: () => void | Promise<void>;
};

export type ObservabilityConfig = {
  enabled: boolean;
  sink: 'noop' | 'stdout-json' | 'sqlite';
  hmacSecret?: string;
  sqlitePath?: string;
  trustProxy: boolean;
  debug: boolean;
  summaryEnabled?: boolean;
  summaryToken?: string;
  summaryDefaultWindowHours?: number;
  otlpLogsEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  otlpServiceName?: string;
  otlpServiceVersion?: string;
  otlpDeploymentEnvironment?: string;
  otlpTimeoutMs?: number;
  otlpFlushIntervalMs?: number;
  otlpMaxBatchSize?: number;
  otlpMaxQueueSize?: number;
  otlpDropPolicy?: OtlpDropPolicy;
  otlpMaxRetries?: number;
  otlpInitialBackoffMs?: number;
  otlpMaxBackoffMs?: number;
};

export type RequestContext = {
  requestId: string;
  routeId: RouteId;
  recordEvent: (eventName: string, payload?: DomainEventPayload) => void;
};