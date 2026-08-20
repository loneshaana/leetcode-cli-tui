import pc from 'picocolors';
import { JudgeResult } from './api/types';

function asLines(v: string[] | string | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

/** Format an interpret (run) result. `color` toggles ANSI (off for blessed output box). */
export function formatRunResult(r: JudgeResult, opts: { color?: boolean } = {}): string {
  const c = opts.color === false ? noColor : pc;
  const out: string[] = [];

  if (r.compile_error || r.full_compile_error) {
    out.push(c.red('Compile Error'));
    out.push(r.full_compile_error || r.compile_error || '');
    return out.join('\n');
  }
  if (r.runtime_error || r.full_runtime_error) {
    out.push(c.red('Runtime Error'));
    out.push(r.full_runtime_error || r.runtime_error || '');
    return out.join('\n');
  }

  const ok = r.correct_answer === true;
  out.push(ok ? c.green('Accepted (sample tests passed)') : c.red('Wrong Answer (sample tests)'));

  const got = asLines(r.code_answer);
  const expected = asLines(r.expected_code_answer);
  const stdout = asLines(r.std_output).filter(Boolean);

  if (got.length) out.push(c.bold('Output:  ') + got.join(' | '));
  if (expected.length) out.push(c.bold('Expected:') + ' ' + expected.join(' | '));
  if (stdout.length) out.push(c.dim('Stdout:  ' + stdout.join(' | ')));
  if (r.status_runtime) out.push(c.dim('Runtime: ' + r.status_runtime));
  return out.join('\n');
}

/** Format a submission result. */
export function formatSubmitResult(r: JudgeResult, opts: { color?: boolean } = {}): string {
  const c = opts.color === false ? noColor : pc;
  const out: string[] = [];
  const msg = r.status_msg || 'Unknown';

  if (r.compile_error || r.full_compile_error) {
    out.push(c.red('Compile Error'));
    out.push(r.full_compile_error || r.compile_error || '');
    return out.join('\n');
  }

  const accepted = msg === 'Accepted';
  out.push(accepted ? c.green(`\u2713 ${msg}`) : c.red(`\u2717 ${msg}`));

  if (typeof r.total_correct === 'number' && typeof r.total_testcases === 'number') {
    out.push(c.bold('Cases:   ') + `${r.total_correct}/${r.total_testcases}`);
  }
  if (r.status_runtime) {
    const pctl =
      typeof r.runtime_percentile === 'number' ? ` (beats ${r.runtime_percentile.toFixed(1)}%)` : '';
    out.push(c.bold('Runtime: ') + r.status_runtime + c.dim(pctl));
  }
  if (r.status_memory) {
    const pctl =
      typeof r.memory_percentile === 'number' ? ` (beats ${r.memory_percentile.toFixed(1)}%)` : '';
    out.push(c.bold('Memory:  ') + r.status_memory + c.dim(pctl));
  }
  if (!accepted) {
    if (r.last_testcase) out.push(c.bold('Last case:') + ' ' + r.last_testcase.replace(/\n/g, ' \u21b5 '));
    if (r.code_output) out.push(c.bold('Output:  ') + asLines(r.code_output).join(' | '));
    if (r.expected_output) out.push(c.bold('Expected:') + ' ' + r.expected_output.replace(/\n/g, ' | '));
    if (r.runtime_error || r.full_runtime_error) out.push(c.red(r.full_runtime_error || r.runtime_error || ''));
  }
  return out.join('\n');
}

// A no-op color shim matching the subset of picocolors we use.
const noColor = {
  red: (s: string) => s,
  green: (s: string) => s,
  yellow: (s: string) => s,
  cyan: (s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
} as unknown as typeof pc;
