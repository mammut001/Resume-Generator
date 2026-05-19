import { DomainEvent, ObservabilitySink, RequestObservation } from './types.js';

export type ObservabilityWriter = (line: string) => void;

type StdoutRecord =
  | { kind: 'request_observation'; record: RequestObservation }
  | { kind: 'domain_event'; record: DomainEvent };

export function createStdoutObservabilitySink(writer: ObservabilityWriter = defaultWriter): ObservabilitySink {
  return {
    recordRequest: observation => {
      writeRecord(writer, { kind: 'request_observation', record: observation });
    },
    recordEvent: event => {
      writeRecord(writer, { kind: 'domain_event', record: event });
    },
    close: () => undefined,
  };
}

function writeRecord(writer: ObservabilityWriter, record: StdoutRecord) {
  writer(JSON.stringify(record));
}

function defaultWriter(line: string) {
  process.stdout.write(`${line}\n`);
}