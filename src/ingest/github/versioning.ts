export type VersionPick = {
  ref: string;
  label: string;
};

export function pickDefaultVersion(input: {
  defaultBranch: string;
  tags: string[];
}): VersionPick {
  if (input.tags.length === 0) {
    return {
      ref: input.defaultBranch,
      label: input.defaultBranch,
    };
  }

  const latest = input.tags[0] ?? input.defaultBranch;
  return {
    ref: latest,
    label: extractMajorVersion(latest),
  };
}

export function pickLatestForSeries(input: { tags: string[]; seriesLabel: string }): string | null {
  const major = parseSeriesLabel(input.seriesLabel);
  if (major === null) return null;
  const stable = input.tags
    .map(parseSemverTag)
    .filter((t): t is SemverTag => t !== null && t.major === major);
  if (stable.length === 0) return null;
  stable.sort(compareSemverDesc);
  return stable[0].raw;
}

export function parseSeriesLabel(label: string): number | null {
  const match = label.trim().match(/^v?(\d+)\.x$/i);
  if (!match) return null;
  return Number(match[1]);
}

export function getLatestTagByMajor(tags: string[]): Map<number, string> {
  const latest = new Map<number, SemverTag>();
  for (const tag of tags) {
    const parsed = parseSemverTag(tag);
    if (!parsed) continue;
    const existing = latest.get(parsed.major);
    if (!existing || compareSemverDesc(parsed, existing) < 0) {
      latest.set(parsed.major, parsed);
    }
  }
  const output = new Map<number, string>();
  for (const [major, value] of latest.entries()) {
    output.set(major, value.raw);
  }
  return output;
}

export function extractMajorVersion(tag: string): string {
  const trimmed = tag.trim();
  if (/^\d+\.x$/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/(\d+)\.\d+/);
  if (match) return `${match[1]}.x`;
  return trimmed;
}

type SemverTag = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
};

function parseSemverTag(tag: string): SemverTag | null {
  const cleaned = tag.trim();
  const match = cleaned.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    raw: cleaned,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemverDesc(a: SemverTag, b: SemverTag): number {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}
