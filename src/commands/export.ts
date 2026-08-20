import * as fs from 'fs';
import { parseSolutionFile, exportSolutionCode, defaultExportPath } from '../solution';
import * as log from '../util/log';

interface ExportOptions {
  out?: string;
}

/** Save the clean solution code (no metadata/description) from a solution file to disk. */
export async function exportCommand(file: string, opts: ExportOptions): Promise<void> {
  if (!fs.existsSync(file)) {
    log.error(`File not found: ${file}`);
    process.exitCode = 1;
    return;
  }
  const { meta, code } = parseSolutionFile(file);
  const out = opts.out || defaultExportPath(file, meta);
  exportSolutionCode(code, out);
  log.success(`Saved clean solution to: ${out}`);
}
