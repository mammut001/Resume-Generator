import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { DomainEventPayload, RequestContext } from './types.js';

const requestContextKey = Symbol('request-context');

type RequestWithContext = IncomingMessage & {
  [requestContextKey]?: RequestContext;
};

export function createRequestId(): string {
  return randomUUID();
}

export function setRequestContext(req: IncomingMessage, context: RequestContext): void {
  (req as RequestWithContext)[requestContextKey] = context;
}

export function getRequestContext(req: IncomingMessage): RequestContext | undefined {
  return (req as RequestWithContext)[requestContextKey];
}

export function recordDomainEvent(req: IncomingMessage, eventName: string, payload: DomainEventPayload = {}): void {
  getRequestContext(req)?.recordEvent(eventName, payload);
}