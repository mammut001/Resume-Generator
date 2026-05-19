export type TypstRenderResult = {
  ok: boolean;
  pdfBlob?: Blob;
  svgHtml?: string;
  error?: string;
};

const renderEndpoint = import.meta.env.VITE_TYPST_RENDER_ENDPOINT || '/api/render/typst';

async function requestRender(source: string, format: 'svg' | 'pdf'): Promise<Response> {
  return fetch(renderEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: format === 'svg' ? 'image/svg+xml' : 'application/pdf',
    },
    body: JSON.stringify({ source, format }),
  });
}

async function readError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    const error = payload?.error;

    if (typeof error === 'string') {
      return error;
    }

    if (error?.message) {
      return error.details ? `${error.message}\n${error.details}` : error.message;
    }

    return `Render failed with status ${response.status}`;
  }

  return (await response.text().catch(() => '')) || `Render failed with status ${response.status}`;
}

export async function renderTypst(source: string): Promise<TypstRenderResult> {
  const response = await requestRender(source, 'svg');
  if (!response.ok) {
    return { ok: false, error: await readError(response) };
  }

  return {
    ok: true,
    svgHtml: await response.text(),
  };
}

export async function renderTypstToPdf(source: string): Promise<TypstRenderResult> {
  const response = await requestRender(source, 'pdf');
  if (!response.ok) {
    return { ok: false, error: await readError(response) };
  }

  return {
    ok: true,
    pdfBlob: await response.blob(),
  };
}
