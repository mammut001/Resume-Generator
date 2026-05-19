export type RenderErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'PAYLOAD_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'OBSERVABILITY_UNAVAILABLE'
  | 'PDF_TOO_LARGE'
  | 'PDF_UNSUPPORTED_TYPE'
  | 'PDF_PARSE_FAILED'
  | 'PDF_OCR_FAILED'
  | 'PDF_TEXT_NOT_FOUND'
  | 'TAILORING_NO_JOB_DESCRIPTION'
  | 'TYPST_NOT_FOUND'
  | 'TYPST_TIMEOUT'
  | 'TYPST_COMPILE_ERROR'
  | 'INTERNAL_ERROR';

export type RenderErrorBody = {
  error: {
    code: RenderErrorCode;
    message: string;
    details?: string;
  };
};

export class RenderHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: RenderErrorCode,
    message: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'RenderHttpError';
  }
}

export function sanitizeErrorDetails(details: string, hiddenPaths: string[] = []): string {
  const withoutAnsi = details.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const withoutPaths = hiddenPaths.reduce(
    (result, path) => result.replaceAll(path, '<render-workdir>'),
    withoutAnsi,
  );

  return withoutPaths.slice(0, 4000);
}

export function toRenderError(error: unknown): { statusCode: number; body: RenderErrorBody } {
  if (error instanceof RenderHttpError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Typst render service failed unexpectedly.',
      },
    },
  };
}