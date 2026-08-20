import * as fs from 'fs';
import pc from 'picocolors';
import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies } from '../config';
import { parseSolutionFile } from '../solution';
import { formatRunResult } from '../results';
import * as log from '../util/log';

interface RunOptions {
  testcase?: string; // custom input, newline separated (use \n literal or real newlines)
}

export async function runCommand(file: string, opts: RunOptions): Promise<void> {
  if (!fs.existsSync(file)) {
    log.error(`File not found: ${file}`);
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const cookies = requireCookies(config);
  const client = new LeetCodeClient(cookies);

  const { meta, code } = parseSolutionFile(file);

  // Default test input: the problem's example test cases.
  let dataInput = opts.testcase ? opts.testcase.replace(/\\n/g, '\n') : '';
  if (!dataInput) {
    const problem = await client.getProblem(meta.slug);
    dataInput = problem.exampleTestcases || problem.sampleTestCase || '';
  }

  log.info(`Running ${meta.slug} (${meta.lang}) against sample tests...`);
  const { interpret_id } = await client.interpret({
    slug: meta.slug,
    questionId: meta.questionId,
    lang: meta.lang,
    code,
    dataInput,
  });

  const result = await client.waitForResult(interpret_id, (state) =>
    process.stderr.write(pc.dim(`  judging (${state})...\r`))
  );
  process.stderr.write('\n');
  process.stdout.write(formatRunResult(result) + '\n');
}
