import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const researchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../research/usability-sim');
const researchAvailable = existsSync(path.join(researchDir, 'personas.ts')) || existsSync(path.join(researchDir, 'personas.js'));

describe.skipIf(!researchAvailable)('usability simulator reporting', () => {
  it('defines at least six distinct personas and five workflows', async () => {
    const { simulatedPersonas } = await import('../../research/usability-sim/personas');
    const { usabilityTasks } = await import('../../research/usability-sim/tasks');

    expect(simulatedPersonas).toHaveLength(6);
    expect(new Set(simulatedPersonas.map(persona => persona.id)).size).toBe(simulatedPersonas.length);
    expect(usabilityTasks).toHaveLength(5);
    expect(usabilityTasks.map(task => task.id)).toEqual([
      'build_from_text',
      'import_pdf',
      'recover_packet_pdf',
      'tailor_job',
      'return_existing_work',
    ]);
  });

  it('summarizes stable result schema and ranks recurring friction', async () => {
    const { summarizeResults } = await import('../../research/usability-sim/reporting');
    const results = [
      sampleResult('impatient-job-seeker', 'recover_packet_pdf', false, ['abandonment: packet recovery requires reading page-range warning']),
      sampleResult('detail-oriented-power-user', 'recover_packet_pdf', true, []),
      sampleResult('returning-multi-resume-user', 'return_existing_work', false, ['wrong_document_risk: exported active document without switching']),
    ];

    const summary = summarizeResults(results);

    expect(summary.totalRuns).toBe(3);
    expect(summary.successRate).toBe(33);
    expect(summary.commonFriction[0]).toEqual({ point: 'abandonment: packet recovery requires reading page-range warning', count: 1 });
    expect(summary.severityRanking.map(item => item.issue)).toContain('Packet recovery still reads like a blocker for low-patience users.');
  });

  it('renders the synthetic-usability caveat in the markdown report', async () => {
    const { simulatedPersonas } = await import('../../research/usability-sim/personas');
    const { usabilityTasks } = await import('../../research/usability-sim/tasks');
    const { renderMarkdownReport, summarizeResults } = await import('../../research/usability-sim/reporting');
    const results = [sampleResult('impatient-job-seeker', 'build_from_text', true, [])];
    const output = {
      generatedAt: '2026-05-18T00:00:00.000Z',
      baseUrl: 'http://127.0.0.1:5174',
      mode: 'browser' as const,
      personas: simulatedPersonas,
      tasks: usabilityTasks,
      summary: summarizeResults(results),
      results,
    };

    expect(renderMarkdownReport(output)).toContain('These are synthetic usability runs. They help detect friction, but they do not replace testing with real users.');
  });

  function sampleResult(
    personaId: string,
    taskId: 'build_from_text' | 'import_pdf' | 'recover_packet_pdf' | 'tailor_job' | 'return_existing_work',
    success: boolean,
    confusionPoints: string[],
  ) {
    return {
      personaId,
      taskId,
      success,
      completionTimeMs: 1000,
      stepsTaken: 3,
      backtracks: 0,
      errorsEncountered: [] as string[],
      confusionPoints,
      notes: [] as string[],
    };
  }
});