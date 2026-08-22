import { LeetCodeClient } from '../api/client';
import { Problem } from '../api/types';

/**
 * Resolve a user-supplied reference to a Problem.
 * Accepts: a title slug ("two-sum"), a URL, "daily"/"today", or a numeric frontend id.
 */
export async function resolveProblem(client: LeetCodeClient, ref: string): Promise<Problem> {
  const trimmed = ref.trim();

  if (/^(daily|today)$/i.test(trimmed)) {
    const slug = await client.getDailyProblemSlug();
    return client.getProblem(slug);
  }

  // URL -> slug
  const urlMatch = trimmed.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  if (urlMatch) {
    return client.getProblem(urlMatch[1]);
  }

  // Numeric frontend id -> look it up via search.
  if (/^\d+$/.test(trimmed)) {
    const res = await client.listProblems({ limit: 50, skip: 0, search: trimmed });
    const exact = res.questions.find((q) => q.frontendId === trimmed);
    if (!exact) throw new Error(`No problem found with id ${trimmed}`);
    return client.getProblem(exact.titleSlug);
  }

  // Assume it's already a slug.
  return client.getProblem(trimmed.toLowerCase());
}
