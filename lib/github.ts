import { Octokit } from "@octokit/rest";
import type { PRSnapshot } from "@/lib/contracts";
import { getDemoSnapshot } from "@/lib/fixtures";

const LIMIT_FILES = 25;
const LIMIT_DIFF_LINES = 2_000;

export function parsePullRequestUrl(value: string) {
  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (!match) throw new Error("Enter a public GitHub pull-request URL.");
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export async function fetchSnapshot(prUrl: string): Promise<PRSnapshot> {
  const demo = getDemoSnapshot(prUrl);
  if (demo) return demo;
  const { owner, repo, number } = parsePullRequestUrl(prUrl);
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  try {
    const [{ data: pr }, { data: files }] = await Promise.all([
      octokit.pulls.get({ owner, repo, pull_number: number, mediaType: { format: "diff" } }),
      octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 }),
    ]);
    if (files.length > LIMIT_FILES) throw new Error(`PR too large: maximum ${LIMIT_FILES} changed files.`);
    const unifiedDiff = typeof pr === "string" ? pr : "";
    if (unifiedDiff.split("\n").length > LIMIT_DIFF_LINES) throw new Error(`PR too large: maximum ${LIMIT_DIFF_LINES} diff lines.`);
    const changedFiles = await Promise.all(files.map(async (file) => {
      if (file.status === "removed") return { path: file.filename, content: "", status: "removed" as const };
      const content = await octokit.repos.getContent({ owner, repo, path: file.filename, ref: (pr as never as { head: { sha: string } }).head.sha });
      if (Array.isArray(content.data) || content.data.type !== "file") return { path: file.filename, content: "", status: file.status === "added" ? "added" as const : "modified" as const };
      return { path: file.filename, content: Buffer.from(content.data.content, "base64").toString("utf8"), status: file.status === "added" ? "added" as const : "modified" as const };
    }));
    return { owner, repo, number, title: (pr as never as { title: string }).title, unifiedDiff, changedFiles };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("GitHub could not retrieve this pull request.");
  }
}
