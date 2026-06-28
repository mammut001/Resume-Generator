import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RenderHttpError, sanitizeErrorDetails } from '../lib/errors.js';
import { createSemaphore } from '../lib/semaphore.js';
import { DEFAULT_RENDER_TIMEOUT_MS, parsePositiveIntegerEnv, RenderTypstRequest } from '../lib/validation.js';

const typstCompileSemaphore = createSemaphore(
  parsePositiveIntegerEnv(process.env.TYPST_MAX_CONCURRENT, 4),
);

export type TypstCompileOptions = {
  typstBin?: string;
  timeoutMs?: number;
  maxStderrBytes?: number;
};

export function getRenderContentType(format: RenderTypstRequest['format']): string {
  return format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'application/pdf';
}

export async function compileTypst(
  request: RenderTypstRequest,
  options: TypstCompileOptions = {},
): Promise<Buffer> {
  const release = await typstCompileSemaphore.acquire();

  try {
    const typstBin = options.typstBin || 'typst';
    const timeoutMs = options.timeoutMs || DEFAULT_RENDER_TIMEOUT_MS;
    const maxStderrBytes = options.maxStderrBytes || 12_000;
    const tempDir = await mkdtemp(join(tmpdir(), 'resume-generator-'));

    try {
      const inputPath = join(tempDir, 'resume.typ');
      const outputPath = join(tempDir, `resume.${request.format}`);

      await writeFile(inputPath, request.source, 'utf8');
      await runTypstCompile({ typstBin, inputPath, outputPath, tempDir, timeoutMs, maxStderrBytes });

      return await readFile(outputPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    release();
  }
}

type RunTypstCompileOptions = {
  typstBin: string;
  inputPath: string;
  outputPath: string;
  tempDir: string;
  timeoutMs: number;
  maxStderrBytes: number;
};

function runTypstCompile({
  typstBin,
  inputPath,
  outputPath,
  tempDir,
  timeoutMs,
  maxStderrBytes,
}: RunTypstCompileOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(typstBin, ['compile', '--root', tempDir, inputPath, outputPath], {
      cwd: tempDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    let didTimeout = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    timeout = setTimeout(() => {
      didTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr.on('data', chunk => {
      if (stderr.length >= maxStderrBytes) return;
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, maxStderrBytes);
    });

    child.on('error', error => {
      finish(() => {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          reject(
            new RenderHttpError(
              500,
              'TYPST_NOT_FOUND',
              'Typst CLI was not found. Install typst or configure TYPST_BIN.',
            ),
          );
          return;
        }

        reject(new RenderHttpError(500, 'INTERNAL_ERROR', 'Typst process failed to start.'));
      });
    });

    child.on('close', code => {
      finish(() => {
        if (didTimeout) {
          reject(new RenderHttpError(504, 'TYPST_TIMEOUT', `Typst compile exceeded ${timeoutMs}ms.`));
          return;
        }

        if (code !== 0) {
          reject(
            new RenderHttpError(
              422,
              'TYPST_COMPILE_ERROR',
              'Typst compilation failed.',
              sanitizeErrorDetails(stderr || 'No compiler diagnostics were emitted.', [tempDir]),
            ),
          );
          return;
        }

        resolve();
      });
    });
  });
}