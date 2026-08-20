import pc from 'picocolors';

export function info(msg: string): void {
  process.stderr.write(pc.cyan('info ') + msg + '\n');
}

export function success(msg: string): void {
  process.stderr.write(pc.green('ok   ') + msg + '\n');
}

export function warn(msg: string): void {
  process.stderr.write(pc.yellow('warn ') + msg + '\n');
}

export function error(msg: string): void {
  process.stderr.write(pc.red('error ') + msg + '\n');
}

export function difficultyColor(d: string): string {
  switch ((d || '').toLowerCase()) {
    case 'easy':
      return pc.green(d);
    case 'medium':
      return pc.yellow(d);
    case 'hard':
      return pc.red(d);
    default:
      return d;
  }
}
