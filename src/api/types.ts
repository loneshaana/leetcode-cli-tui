export interface CodeSnippet {
  lang: string;
  langSlug: string;
  code: string;
}

export interface TopicTag {
  name: string;
  slug: string;
}

export interface Problem {
  questionId: string;
  frontendId: string;
  title: string;
  titleSlug: string;
  content: string; // HTML
  difficulty: string;
  isPaidOnly: boolean;
  exampleTestcases: string;
  sampleTestCase: string;
  codeSnippets: CodeSnippet[];
  topicTags: TopicTag[];
  hints: string[];
}

export interface ProblemListItem {
  frontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  status: string | null; // "ac" | "notac" | null
  isPaidOnly: boolean;
  acRate: number;
}

export interface ProblemListResult {
  total: number;
  questions: ProblemListItem[];
}

/** Raw judge result returned by the /check/ polling endpoint. */
export interface JudgeResult {
  state: string; // "PENDING" | "STARTED" | "SUCCESS"
  status_code?: number;
  status_msg?: string;
  run_success?: boolean;
  // run (interpret) fields
  correct_answer?: boolean;
  code_answer?: string[];
  expected_code_answer?: string[];
  code_output?: string[] | string;
  std_output?: string[] | string;
  // submit fields
  total_correct?: number | null;
  total_testcases?: number | null;
  status_runtime?: string;
  status_memory?: string;
  runtime_percentile?: number | null;
  memory_percentile?: number | null;
  last_testcase?: string;
  expected_output?: string;
  // errors
  compile_error?: string;
  full_compile_error?: string;
  runtime_error?: string;
  full_runtime_error?: string;
  [key: string]: unknown;
}

export interface InterpretResponse {
  interpret_id: string;
  test_case: string;
}

export interface SubmitResponse {
  submission_id: number;
}
