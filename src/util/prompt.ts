import * as readline from 'readline';

/** Prompt for a single line of input. */
export function prompt(question: string): Promise<string> {
  return promptSequence([question]).then((a) => a[0]);
}

/** Ask several questions over ONE readline interface (robust across environments). */
export function promptSequence(questions: string[]): Promise<string[]> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answers: string[] = [];
  return new Promise<string[]>((resolve) => {
    const ask = (i: number): void => {
      if (i >= questions.length) {
        rl.close();
        resolve(answers);
        return;
      }
      rl.question(questions[i], (answer) => {
        answers.push(answer.trim());
        ask(i + 1);
      });
    };
    ask(0);
  });
}
