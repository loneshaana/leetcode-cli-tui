import pc from 'picocolors';
import { loadConfig, updateConfig, configPath } from '../config';
import { resolveLang } from '../languages';
import { themeNames } from '../tui/highlight';
import * as log from '../util/log';

interface ConfigOptions {
  lang?: string;
  workspace?: string;
  vim?: string;
  bell?: string;
  tags?: string;
  theme?: string;
}

export async function configCommand(opts: ConfigOptions): Promise<void> {
  const changed: string[] = [];

  if (opts.lang) {
    const lang = resolveLang(opts.lang);
    updateConfig({ lang: lang.slug });
    changed.push(`lang = ${lang.slug}`);
  }
  if (opts.workspace) {
    updateConfig({ workspace: opts.workspace });
    changed.push(`workspace = ${opts.workspace}`);
  }
  if (opts.vim !== undefined) {
    const v = opts.vim.trim().toLowerCase();
    if (!['on', 'off', 'true', 'false'].includes(v)) {
      throw new Error('--vim expects "on" or "off"');
    }
    const enabled = v === 'on' || v === 'true';
    updateConfig({ vim: enabled });
    changed.push(`vim = ${enabled ? 'on' : 'off'}`);
  }
  if (opts.bell !== undefined) {
    const v = opts.bell.trim().toLowerCase();
    if (!['on', 'off', 'true', 'false'].includes(v)) {
      throw new Error('--bell expects "on" or "off"');
    }
    const enabled = v === 'on' || v === 'true';
    updateConfig({ bell: enabled });
    changed.push(`bell = ${enabled ? 'on' : 'off'}`);
  }
  if (opts.tags !== undefined) {
    const v = opts.tags.trim().toLowerCase();
    if (!['on', 'off', 'true', 'false'].includes(v)) {
      throw new Error('--tags expects "on" or "off"');
    }
    const enabled = v === 'on' || v === 'true';
    updateConfig({ tags: enabled });
    changed.push(`tags = ${enabled ? 'on' : 'off'}`);
  }
  if (opts.theme !== undefined) {
    const t = opts.theme.trim().toLowerCase();
    const names = themeNames();
    if (!names.includes(t)) {
      throw new Error(`--theme expects one of: ${names.join(', ')}`);
    }
    updateConfig({ theme: t });
    changed.push(`theme = ${t}`);
  }

  const cfg = loadConfig();
  if (changed.length) {
    log.success('Updated: ' + changed.join(', '));
  }

  process.stdout.write(`${pc.bold('Config')} (${configPath()})\n`);
  process.stdout.write(`  language:  ${cfg.lang}\n`);
  process.stdout.write(`  workspace: ${cfg.workspace}\n`);
  process.stdout.write(`  vim mode:  ${cfg.vim ? pc.green('on') : 'off'}\n`);
  process.stdout.write(`  bell:      ${cfg.bell === false ? 'off' : pc.green('on')}\n`);
  process.stdout.write(`  tags:      ${cfg.tags === false ? 'off' : pc.green('on')}\n`);
  process.stdout.write(`  theme:     ${cfg.theme || 'default'} ${pc.dim(`(${themeNames().join(', ')})`)}\n`);
  process.stdout.write(`  logged in: ${cfg.cookies?.session ? pc.green('yes') : pc.red('no')}\n`);
  if (cfg.cookies?.capturedAt) {
    process.stdout.write(`  session:   captured ${cfg.cookies.capturedAt}\n`);
  }
}
