// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { useLocaleStore } from '@/i18n';

describe('ObservabilityAdminPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useRealTimers();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/admin/observability');

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/observability/summary?hours=24') {
        expect(init?.headers).toEqual({
          Accept: 'application/json',
          Authorization: 'Bearer summary-secret',
        });

        return new Response(JSON.stringify(summaryPayload()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (String(input) === '/api/observability/admin/token') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer summary-secret',
        });
        expect(init?.body).toBe(JSON.stringify({ newToken: 'test-observability-rotated-token' }));

        return new Response(JSON.stringify({
          success: true,
          tokenUpdatedAt: '2026-05-19T00:10:00.000Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
    container.remove();
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  it('renders the observability route and loads OTLP diagnostics with a session token', async () => {
    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('Backend Observability');

    const tokenInput = container.querySelector('input[aria-label="Bearer token"]') as HTMLInputElement;
    const tokenValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    await act(async () => {
      tokenValueSetter?.call(tokenInput, 'summary-secret');
      tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      getButton('Load summary').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Queue usage');
    expect(container.textContent).toContain('2 / 5');
    expect(container.textContent).toContain('Newest');
    expect(container.textContent).toContain('Overflow drops');
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('Failed-export drops');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('Auto refresh every 30s');
    expect(container.textContent).toContain('Queue depth trend');
    expect(container.textContent).toContain('Dropped logs trend');
    expect(sessionStorage.getItem('resume-generator-observability-token')).toBe('summary-secret');
    expect(sessionStorage.getItem('resume-generator-observability-settings')).toContain('"autoRefreshSeconds":"30"');
  });

  it('auto refreshes when a session token and refresh interval are already stored', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('resume-generator-observability-token', 'summary-secret');
    sessionStorage.setItem(
      'resume-generator-observability-settings',
      JSON.stringify({ endpoint: '', hours: '24', autoRefreshSeconds: '15' }),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Auto refresh every 15s');

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    await flushUi();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rotates the admin token and stores the replacement token in session storage', async () => {
    await act(async () => {
      root.render(<App />);
    });

    const inputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const currentTokenInput = container.querySelector('input[aria-label="Bearer token"]') as HTMLInputElement;
    const newTokenInput = container.querySelector('input[aria-label="New admin token"]') as HTMLInputElement;
    const confirmTokenInput = container.querySelector('input[aria-label="Confirm new admin token"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter?.call(currentTokenInput, 'summary-secret');
      currentTokenInput.dispatchEvent(new Event('input', { bubbles: true }));
      inputValueSetter?.call(newTokenInput, 'test-observability-rotated-token');
      newTokenInput.dispatchEvent(new Event('input', { bubbles: true }));
      inputValueSetter?.call(confirmTokenInput, 'test-observability-rotated-token');
      confirmTokenInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      getButton('Change token').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Admin token updated at');
    expect(sessionStorage.getItem('resume-generator-observability-token')).toBe('test-observability-rotated-token');
  });

  it('renders the observability dashboard in Chinese when the locale is zh-CN', async () => {
    useLocaleStore.getState().setLocale('zh-CN');

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('后端可观测性');

    const tokenInput = container.querySelector('input[aria-label="Bearer 令牌"]') as HTMLInputElement;
    const tokenValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    await act(async () => {
      tokenValueSetter?.call(tokenInput, 'summary-secret');
      tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      getButton('加载摘要').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain('后端可观测性');
    expect(container.textContent).toContain('队列使用率');
    expect(container.textContent).toContain('每 30 秒自动刷新');
    expect(container.textContent).toContain('队列深度趋势');
    expect(container.textContent).toContain('丢日志趋势');
  });

  function getButton(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }
});

function summaryPayload() {
  return {
    generatedAt: '2026-05-19T00:00:00.000Z',
    windowHours: 24,
    requests: {
      total: 24,
      errorCount: 3,
      errorRate: 0.125,
      p95DurationMs: 182,
      recentCounts: [
        { bucketStart: '2026-05-18T21:00:00Z', requestCount: 10, errorCount: 1 },
        { bucketStart: '2026-05-18T22:00:00Z', requestCount: 16, errorCount: 2 },
        { bucketStart: '2026-05-18T23:00:00Z', requestCount: 24, errorCount: 3 },
      ],
    },
    recentFailures: [
      {
        routeId: 'render_typst',
        statusCode: 503,
        errorCode: 'INTERNAL_ERROR',
        count: 2,
        lastOccurredAt: '2026-05-19T00:00:00.000Z',
      },
    ],
    topRoutes: [
      { routeId: 'render_typst', requestCount: 12, errorCount: 2, errorRate: 0.1667 },
    ],
    topIpHashes: [
      { ipHash: 'ip-hash-1', requestCount: 8, errorCount: 1 },
    ],
    eventCounts: [
      { eventName: 'render_failed', count: 2 },
    ],
    sinks: {
      otlp: {
        queueDepth: 2,
        queueCapacity: 5,
        dropPolicy: 'newest',
        inFlight: false,
        successfulExports: 6,
        failedExports: 1,
        exportedLogRecords: 120,
        droppedLogRecords: 5,
        droppedOverflowLogRecords: 3,
        droppedFailedExportLogRecords: 2,
        retryCount: 4,
        lastErrorAt: '2026-05-19T00:00:00.000Z',
        lastErrorMessage: 'OTLP logs export failed with status 503.',
        lastSuccessAt: '2026-05-18T23:58:00.000Z',
        history: {
          samples: [
            {
              occurredAt: '2026-05-18T23:40:00.000Z',
              queueDepth: 1,
              queueCapacity: 5,
              dropPolicy: 'newest',
              inFlight: false,
              successfulExports: 4,
              failedExports: 0,
              exportedLogRecords: 80,
              droppedLogRecords: 1,
              droppedOverflowLogRecords: 1,
              droppedFailedExportLogRecords: 0,
              retryCount: 1,
            },
            {
              occurredAt: '2026-05-18T23:50:00.000Z',
              queueDepth: 4,
              queueCapacity: 5,
              dropPolicy: 'newest',
              inFlight: true,
              successfulExports: 5,
              failedExports: 1,
              exportedLogRecords: 100,
              droppedLogRecords: 3,
              droppedOverflowLogRecords: 2,
              droppedFailedExportLogRecords: 1,
              retryCount: 3,
            },
            {
              occurredAt: '2026-05-19T00:00:00.000Z',
              queueDepth: 2,
              queueCapacity: 5,
              dropPolicy: 'newest',
              inFlight: false,
              successfulExports: 6,
              failedExports: 1,
              exportedLogRecords: 120,
              droppedLogRecords: 5,
              droppedOverflowLogRecords: 3,
              droppedFailedExportLogRecords: 2,
              retryCount: 4,
            },
          ],
        },
      },
    },
  };
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
}
