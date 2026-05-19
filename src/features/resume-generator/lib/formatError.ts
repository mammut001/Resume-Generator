export function formatError(error: unknown): string {
  if (error === null) return 'Unknown error';
  if (error === undefined) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}