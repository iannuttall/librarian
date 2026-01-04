import { loadConfig } from "../core/config";
import { promptLine } from "../core/prompt";
import { fetchRepoInfo, fetchStableTags, fetchBranches } from "../ingest/github/api";
import { pickDefaultVersion, pickLatestForSeries, extractMajorVersion } from "../ingest/github/versioning";
import { updateSourceRef } from "../store";
import type { Database } from "bun:sqlite";
import { promptFromList } from "./prompts";

export async function maybeUpdateSourceRef(
  db: Database,
  source: { owner?: string | null; repo?: string | null; version_label?: string | null; id: number; ref?: string | null },
): Promise<void> {
  if (!source?.owner || !source?.repo) return;
  const label = source.version_label;
  if (!label) return;
  const major = pickLatestForSeries({ tags: [], seriesLabel: label });
  if (major === null) return;
  const config = loadConfig();
  if (!config.github?.token) return;
  const tags = await fetchStableTags(source.owner, source.repo, config.github.token);
  const next = pickLatestForSeries({
    tags: tags.map((t) => t.name),
    seriesLabel: label,
  });
  if (!next || next === source.ref) return;
  updateSourceRef(db, source.id, next);
  source.ref = next;
}

export async function selectRefAndLabel(
  owner: string,
  repo: string,
  token?: string,
  repoInfo?: { defaultBranch: string },
): Promise<{ ref: string; label: string }> {
  const info = repoInfo ?? (await fetchRepoInfo(owner, repo, token));
  if (!info) return { ref: "main", label: "main" };
  const tags = await fetchStableTags(owner, repo, token);
  const branches = await fetchBranches(owner, repo, token);
  const pick = pickDefaultVersion({
    defaultBranch: info.defaultBranch,
    tags: tags.map((t) => t.name),
  });

  const hasTags = tags.length > 0;
  const hasBranches = branches.length > 0;
  let refType = hasTags ? "tag" : "branch";
  if (hasTags && hasBranches) {
    const choice = await promptLine(`Ref type (tag/branch, default ${refType}): `);
    if (choice && (choice === "tag" || choice === "branch")) refType = choice;
  }

  const options = refType === "tag" ? tags.map((t) => t.name) : branches.map((b) => b.name);
  const defaultRef = refType === "tag" ? pick.ref : info.defaultBranch;
  if (!token && options.length === 0) {
    console.log("No tags or branches found.");
    console.log("If this is a public repo, add a GitHub token and try again.");
  }
  const ref = await promptFromList(`Select ${refType}`, options, defaultRef);
  const defaultLabel = refType === "tag" ? extractMajorVersion(ref) : ref;
  const versionLabelInput = await promptLine(`Version label (default ${defaultLabel}): `);
  const versionLabel = versionLabelInput || defaultLabel;
  return { ref, label: versionLabel };
}
