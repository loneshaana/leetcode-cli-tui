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

  // Numeric frontend id -> look it up via search. LeetCode's search does not
  // guarantee an exact-id match ranks first, so scan a bounded number of pages
  // and require an exact frontendId match.
  if (/^\d+$/.test(trimmed)) {
    const target = String(Number(trimmed)); // normalize e.g. "0001" -> "1"
    const pageSize = 50;
    const maxScan = 200; // exact-id matches rank near the top; keep this bounded
    let skip = 0;
    let total = Infinity;
    while (skip < Math.min(total, maxScan)) {
      const res = await client.listProblems({ limit: pageSize, skip, search: trimmed });
      total = res.total;
      const exact = res.questions.find((q) => q.frontendId === target);
      if (exact) return client.getProblem(exact.titleSlug);
      if (!res.questions.length) break;
      skip += res.questions.length;
    }
    throw new Error(`No problem found with id ${trimmed}`);
  }

  // Assume it's already a slug.
  return client.getProblem(trimmed.toLowerCase());
}
