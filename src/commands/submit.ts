import * as fs from 'fs';
import pc from 'picocolors';
import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies, recordSolved } from '../config';
import { parseSolutionFile } from '../solution';
import { formatSubmitResult } from '../results';
import { celebrateCli } from '../tui/fun';
import * as log from '../util/log';

export async function submitCommand(file: string): Promise<void> {
  if (!fs.existsSync(file)) {
    log.error(`File not found: ${file}`);
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const cookies = requireCookies(config);
  const client = new LeetCodeClient(cookies);

  const { meta, code } = parseSolutionFile(file);

  log.info(`Submitting ${meta.slug} (${meta.lang})...`);
  const { submission_id } = await client.submit({
    slug: meta.slug,
    questionId: meta.questionId,
    lang: meta.lang,
    code,
  });

  const result = await client.waitForResult(
    submission_id,
    (state) => process.stderr.write(pc.dim(`  judging (${state})...\r`)),
    60000
  );
  process.stderr.write('\n');
  process.stdout.write(formatSubmitResult(result) + '\n');
  if (result.status_msg === 'Accepted') {
    const solved = recordSolved(meta.slug);
    if (config.bell !== false) process.stderr.write('\x07');
    process.stdout.write('\n' + celebrateCli(solved) + '\n');
  }
}
