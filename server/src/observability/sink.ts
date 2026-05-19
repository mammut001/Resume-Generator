import { createSqliteObservabilitySink } from './sqliteSink.js';
import { createOtlpHttpJsonObservabilitySink, OtlpFetch } from './otlpSink.js';
import { createStdoutObservabilitySink, ObservabilityWriter } from './stdoutSink.js';
import { ObservabilityConfig, ObservabilityDiagnostics, ObservabilitySink } from './types.js';

export function createObservabilitySink(
  config: ObservabilityConfig,
  options: { writer?: ObservabilityWriter; fetchImpl?: OtlpFetch } = {},
): ObservabilitySink {
  if (!config.enabled || (config.sink === 'noop' && !config.otlpLogsEndpoint)) {
    return createNoopObservabilitySink();
  }

  const sinks: ObservabilitySink[] = [];

  if (config.sink === 'sqlite') {
    if (!config.sqlitePath) {
      throw new Error('Observability sqlite sink requires sqlitePath.');
    }

    sinks.push(createSqliteObservabilitySink(config.sqlitePath));
  } else if (config.sink === 'stdout-json') {
    sinks.push(createStdoutObservabilitySink(options.writer));
  }

  if (config.otlpLogsEndpoint) {
    sinks.push(createOtlpHttpJsonObservabilitySink({
      endpoint: config.otlpLogsEndpoint,
      headers: config.otlpHeaders,
      serviceName: config.otlpServiceName || 'resume-generator-backend',
      serviceVersion: config.otlpServiceVersion,
      deploymentEnvironment: config.otlpDeploymentEnvironment,
      debug: config.debug,
      timeoutMs: config.otlpTimeoutMs,
      flushIntervalMs: config.otlpFlushIntervalMs,
      maxBatchSize: config.otlpMaxBatchSize,
      sqlitePath: config.sqlitePath,
      maxQueueSize: config.otlpMaxQueueSize,
      dropPolicy: config.otlpDropPolicy,
      maxRetries: config.otlpMaxRetries,
      initialBackoffMs: config.otlpInitialBackoffMs,
      maxBackoffMs: config.otlpMaxBackoffMs,
      fetchImpl: options.fetchImpl,
    }));
  }

  return sinks.length === 1 ? sinks[0] : createCompositeObservabilitySink(sinks);
}

export function createNoopObservabilitySink(): ObservabilitySink {
  return {
    recordRequest: () => undefined,
    recordEvent: () => undefined,
    getDiagnostics: () => ({}),
    close: () => undefined,
  };
}

function createCompositeObservabilitySink(sinks: ObservabilitySink[]): ObservabilitySink {
  return {
    recordRequest: observation => {
      return Promise.allSettled(sinks.map(sink => Promise.resolve(sink.recordRequest(observation)))).then(() => undefined);
    },
    recordEvent: event => {
      return Promise.allSettled(sinks.map(sink => Promise.resolve(sink.recordEvent(event)))).then(() => undefined);
    },
    getDiagnostics: () => {
      return sinks.reduce<ObservabilityDiagnostics>((merged, sink) => {
        const diagnostics = sink.getDiagnostics?.();
        return diagnostics ? { ...merged, ...diagnostics } : merged;
      }, {});
    },
    close: () => {
      return Promise.allSettled(sinks.map(sink => Promise.resolve(sink.close?.()))).then(() => undefined);
    },
  };
}