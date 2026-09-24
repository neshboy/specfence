import * as core from "@actions/core";
import * as github from "@actions/github";
import { checkScope, DecodeError, ManifestError, safeDecodeUtf8, safeParseManifest } from "@specfence/core";
import { buildTreeMap, toChangeEntries, type PullFile } from "./github.js";
import { buildNotAdoptedMarkdown, buildSummaryMarkdown } from "./summary.js";

// GitHub's Pulls Files API caps out at 3000 files regardless of pagination -
// fail closed rather than silently validate a truncated list.
const MAX_FILES = 3000;

interface PullRequestPayload {
  number: number;
  changed_files?: number;
  base: { sha: string };
  head: { sha: string };
}

async function run(): Promise<void> {
  // This action must be wired to `pull_request` (never `pull_request_target`)
  // - see docs/security.md. It never calls actions/checkout and never reads
  // a single byte of PR-authored code, only two pieces of base-ref-pinned
  // metadata (the manifest, and the diff file list) via the REST API.
  const pullRequest = github.context.payload.pull_request as unknown as PullRequestPayload | undefined;
  if (!pullRequest) {
    core.setFailed(
      "SpecFence must run on a pull_request event. No pull_request context was found in this run."
    );
    return;
  }

  const manifestPath = core.getInput("manifest-path") || ".specfence/scope.yaml";
  const token = core.getInput("token", { required: true });
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const baseSha = pullRequest.base.sha;
  const headSha = pullRequest.head.sha;

  // 1. Manifest, pinned to the base ref - never the PR head. A confirmed
  //    404 means "not adopted yet", which is success, not a violation.
  let manifestText: string;
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: manifestPath, ref: baseSha });
    if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
      core.setFailed(`SpecFence: "${manifestPath}" on the base branch is not a regular file.`);
      return;
    }
    // Strict decode, not Buffer#toString("utf8") - that's lossy (silently
    // substitutes U+FFFD for invalid bytes), which previously let a
    // corrupted manifest byte silently defeat a `deny` rule. See
    // packages/core/src/text.ts and docs/security.md.
    manifestText = safeDecodeUtf8(Buffer.from(data.content, "base64"), manifestPath);
  } catch (err) {
    if (err instanceof DecodeError) {
      core.setFailed(`SpecFence: ${manifestPath} on the base branch is not valid UTF-8 - failing closed. (${err.message})`);
      return;
    }
    const status = (err as { status?: number }).status;
    if (status === 404) {
      await core.summary.addRaw(buildNotAdoptedMarkdown(manifestPath)).write();
      core.info(`No ${manifestPath} on base ref ${baseSha} - nothing enforced yet.`);
      return;
    }
    // Ambiguous failure (rate limit, 5xx, network) - fail closed, and this
    // message must read as a distinct error, never as a normal violation.
    core.setFailed(
      `SpecFence could not read ${manifestPath} from the base branch (not a 404 - failing closed): ${(err as Error).message}`
    );
    return;
  }

  let manifest;
  try {
    manifest = safeParseManifest(manifestText, { source: `${manifestPath} @ ${baseSha}` });
  } catch (err) {
    if (err instanceof ManifestError) {
      core.setFailed(`SpecFence: invalid manifest - ${err.message}`);
      return;
    }
    throw err;
  }

  // 2. Changed files, fully paginated, with truncation checked against the
  //    PR's own authoritative changed_files count rather than guessed at.
  let files: PullFile[];
  try {
    files = (await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullRequest.number,
      per_page: 100,
    })) as PullFile[];
  } catch (err) {
    core.setFailed(`SpecFence could not list changed files for this PR (failing closed): ${(err as Error).message}`);
    return;
  }

  const reportedTotal = pullRequest.changed_files ?? files.length;
  if (files.length > MAX_FILES || reportedTotal > files.length) {
    core.setFailed(
      `SpecFence: this PR reports ${reportedTotal} changed files but only ${files.length} could be listed (GitHub's API caps this at ${MAX_FILES}). Failing closed rather than validate a truncated list.`
    );
    return;
  }

  // 3. Recursive tree listings, used only to detect the symlink/submodule
  //    mode bits the Pulls Files API doesn't expose - see ./github.ts.
  let treesReliable = true;
  let headTreeMap = new Map<string, string>();
  let baseTreeMap = new Map<string, string>();
  try {
    const [headTree, baseTree] = await Promise.all([
      octokit.rest.git.getTree({ owner, repo, tree_sha: headSha, recursive: "true" }),
      octokit.rest.git.getTree({ owner, repo, tree_sha: baseSha, recursive: "true" }),
    ]);
    if (headTree.data.truncated || baseTree.data.truncated) {
      treesReliable = false;
      core.warning(
        "SpecFence: this repository's file tree was too large for GitHub to return in full - symlink/submodule detection is skipped for this run. Path/glob scope checking above is unaffected."
      );
    } else {
      headTreeMap = buildTreeMap(headTree.data.tree);
      baseTreeMap = buildTreeMap(baseTree.data.tree);
    }
  } catch (err) {
    treesReliable = false;
    core.warning(
      `SpecFence: could not fetch tree listings for symlink/submodule detection, skipping for this run: ${(err as Error).message}`
    );
  }

  const changes = toChangeEntries(files, headTreeMap, baseTreeMap, treesReliable);
  const result = checkScope(manifest, changes);

  await core.summary.addRaw(buildSummaryMarkdown(result, { manifestPath, baseSha, treesReliable })).write();

  if (!result.passed) {
    core.setFailed(`SpecFence: ${result.violations.length} file(s) fell outside the scope declared in ${manifestPath}.`);
  } else {
    core.info(`SpecFence: all ${changes.length} changed file(s) are within scope.`);
  }
}

run().catch((err) => {
  core.setFailed(`SpecFence crashed unexpectedly (failing closed): ${(err as Error).message}`);
});
