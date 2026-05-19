import { describe, expect, it } from 'vitest';
import { simulatedPersonas } from '../../research/usability-sim/personas';
import { usabilityTasks } from '../../research/usability-sim/tasks';
import { renderMarkdownReport, summarizeResults, type UsabilityOutput, type UsabilityRunResult } from '../../research/usability-sim/reporting';

describe('usability simulator reporting', () => {
  it('defines at least six distinct personas and five workflows', () => {
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

  it('summarizes stable result schema and ranks recurring friction', () => {
    const results: UsabilityRunResult[] = [
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

  it('renders the synthetic-usability caveat in the markdown report', () => {
    const results = [sampleResult('impatient-job-seeker', 'build_from_text', true, [])];
    const output: UsabilityOutput = {
      generatedAt: '2026-05-18T00:00:00.000Z',
      baseUrl: 'http://127.0.0.1:5174',
      mode: 'browser',
      personas: simulatedPersonas,
      tasks: usabilityTasks,
      summary: summarizeResults(results),
      results,
    };

    expect(renderMarkdownReport(output)).toContain('These are synthetic usability runs. They help detect friction, but they do not replace testing with real users.');
  });

  function sampleResult(personaId: string, taskId: UsabilityRunResult['taskId'], success: boolean, confusionPoints: string[]): UsabilityRunResult {
    return {
      personaId,
      taskId,
      success,
      completionTimeMs: 1000,
      stepsTaken: 3,
      backtracks: 0,
      errorsEncountered: [],
      confusionPoints,
      notes: [],
    };
  }
});