import { StoredCookies } from '../config';
import { PROBLEM_LIST, QUESTION_DATA, DAILY_QUESTION, CURRENT_USER } from './queries';
import {
  InterpretResponse,
  JudgeResult,
  Problem,
  ProblemListItem,
  ProblemListResult,
  SubmitResponse,
} from './types';

const BASE = 'https://leetcode.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class LeetCodeError extends Error {}

export class LeetCodeClient {
  constructor(private cookies: StoredCookies) {}

  private cookieHeader(): string {
    return `LEETCODE_SESSION=${this.cookies.session}; csrftoken=${this.cookies.csrftoken}`;
  }

  private baseHeaders(referer: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      origin: BASE,
      referer,
      cookie: this.cookieHeader(),
      'x-csrftoken': this.cookies.csrftoken,
    };
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE}/graphql`, {
      method: 'POST',
      headers: this.baseHeaders(`${BASE}/problemset/all/`),
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new LeetCodeError(`GraphQL request failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors && json.errors.length) {
      throw new LeetCodeError(json.errors.map((e) => e.message).join('; '));
    }
    if (!json.data) throw new LeetCodeError('GraphQL response contained no data');
    return json.data;
  }

  async getProblem(titleSlug: string): Promise<Problem> {
    const data = await this.graphql<{ question: any }>(QUESTION_DATA, { titleSlug });
    const q = data.question;
    if (!q) throw new LeetCodeError(`Problem "${titleSlug}" not found`);
    return {
      questionId: q.questionId,
      frontendId: q.questionFrontendId,
      title: q.title,
      titleSlug: q.titleSlug,
      content: q.content || '',
      difficulty: q.difficulty,
      isPaidOnly: !!q.isPaidOnly,
      exampleTestcases: q.exampleTestcases || q.sampleTestCase || '',
      sampleTestCase: q.sampleTestCase || '',
      codeSnippets: q.codeSnippets || [],
      topicTags: q.topicTags || [],
      hints: q.hints || [],
    };
  }

  async listProblems(opts: {
    limit?: number;
    skip?: number;
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    search?: string;
    status?: 'AC' | 'NOT_STARTED' | 'TRIED';
  }): Promise<ProblemListResult> {
    const filters: Record<string, unknown> = {};
    if (opts.difficulty) filters.difficulty = opts.difficulty;
    if (opts.search) filters.searchKeywords = opts.search;
    if (opts.status) filters.status = opts.status;
    const data = await this.graphql<{ problemsetQuestionList: { total: number; questions: any[] } }>(
      PROBLEM_LIST,
      {
        categorySlug: '',
        skip: opts.skip ?? 0,
        limit: opts.limit ?? 50,
        filters,
      }
    );
    const list = data.problemsetQuestionList;
    const questions: ProblemListItem[] = list.questions.map((q) => ({
      frontendId: q.frontendQuestionId,
      title: q.title,
      titleSlug: q.titleSlug,
      difficulty: q.difficulty,
      status: q.status ?? null,
      isPaidOnly: !!q.isPaidOnly,
      acRate: q.acRate ?? 0,
    }));
    return { total: list.total, questions };
  }

  /** Returns the signed-in user, or null if the session is invalid/expired. */
  async getCurrentUser(): Promise<{ userId: string; username: string } | null> {
    const data = await this.graphql<{
      userStatus: { userId: string | null; username: string | null; isSignedIn: boolean };
    }>(CURRENT_USER, {});
    const s = data.userStatus;
    if (!s || !s.isSignedIn || !s.userId) return null;
    return { userId: String(s.userId), username: s.username || '' };
  }

  async getDailyProblemSlug(): Promise<string> {
    const data = await this.graphql<{
      activeDailyCodingChallengeQuestion: { question: { titleSlug: string } };
    }>(DAILY_QUESTION, {});
    return data.activeDailyCodingChallengeQuestion.question.titleSlug;
  }

  /** Kick off a "run against test cases" (interpret) request. */
  async interpret(params: {
    slug: string;
    questionId: string;
    lang: string;
    code: string;
    dataInput: string;
  }): Promise<InterpretResponse> {
    const url = `${BASE}/problems/${params.slug}/interpret_solution/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.baseHeaders(`${BASE}/problems/${params.slug}/`),
      body: JSON.stringify({
        lang: params.lang,
        question_id: params.questionId,
        typed_code: params.code,
        data_input: params.dataInput,
      }),
    });
    if (!res.ok) {
      throw new LeetCodeError(await describeHttpError(res, 'run'));
    }
    return (await res.json()) as InterpretResponse;
  }

  /** Kick off a submission. */
  async submit(params: {
    slug: string;
    questionId: string;
    lang: string;
    code: string;
  }): Promise<SubmitResponse> {
    const url = `${BASE}/problems/${params.slug}/submit/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.baseHeaders(`${BASE}/problems/${params.slug}/`),
      body: JSON.stringify({
        lang: params.lang,
        question_id: params.questionId,
        typed_code: params.code,
      }),
    });
    if (!res.ok) {
      throw new LeetCodeError(await describeHttpError(res, 'submit'));
    }
    return (await res.json()) as SubmitResponse;
  }

  /** Poll the judge until it reaches a terminal state. */
  async waitForResult(
    id: string | number,
    onTick?: (state: string) => void,
    timeoutMs = 30000
  ): Promise<JudgeResult> {
    const url = `${BASE}/submissions/detail/${id}/check/`;
    const start = Date.now();
    let delay = 600;
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          referer: `${BASE}/`,
          cookie: this.cookieHeader(),
          'x-csrftoken': this.cookies.csrftoken,
        },
      });
      if (res.ok) {
        const result = (await res.json()) as JudgeResult;
        if (result.state === 'SUCCESS') return result;
        if (onTick) onTick(result.state);
      }
      await sleep(delay);
      delay = Math.min(delay + 200, 1500);
    }
    throw new LeetCodeError('Timed out waiting for judge result');
  }
}

async function describeHttpError(res: Response, action: string): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  if (res.status === 403) {
    return `Failed to ${action}: 403 Forbidden. Your session may have expired. Run "leetcode login" again.`;
  }
  const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
  return `Failed to ${action}: ${res.status} ${res.statusText}${snippet ? ` - ${snippet}` : ''}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
