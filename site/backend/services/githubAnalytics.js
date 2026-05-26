function toIsoTime(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function classifyCommitMessage(message) {
  const text = String(message || "").trim();
  if (!text) return "other";

  const conventional = text.match(/^([a-z]+)(\([^)]+\))?(!)?:\s+(.+)$/i);
  if (conventional) {
    const type = String(conventional[1] || "").toLowerCase();
    if (type === "feat") return "features";
    if (type === "fix" || type === "hotfix") return "fixes";
    return "other";
  }

  const lower = text.toLowerCase();

  const featureKeywords = ["add", "added", "adding", "implement", "implemented", "introduce", "create", "support", "feature", "launch"];
  if (featureKeywords.some((keyword) => lower.includes(keyword))) {
    return "features";
  }

  const fixKeywords = ["fix", "fixed", "bug", "patch", "resolve", "resolved", "hotfix", "correct"];
  if (fixKeywords.some((keyword) => lower.includes(keyword))) {
    return "fixes";
  }

  return "other";
}

function filterByDays(commits, days) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) return commits;

  const cutoff = Date.now() - parsed * 24 * 60 * 60 * 1000;
  return commits.filter((commit) => {
    const timestamp = Date.parse(String(commit.committed_at || commit.committedAt || ""));
    if (Number.isNaN(timestamp)) return false;
    return timestamp >= cutoff;
  });
}

function buildRepositorySummary(commits, options = {}) {
  const filtered = filterByDays(Array.isArray(commits) ? commits : [], options.days);
  const authors = new Set();
  const files = new Set();

  let additions = 0;
  let deletions = 0;
  let firstCommitAt = "";
  let latestCommitAt = "";

  filtered.forEach((commit) => {
    const committedAt = toIsoTime(commit.committed_at || commit.committedAt);
    if (committedAt) {
      if (!firstCommitAt || committedAt < firstCommitAt) firstCommitAt = committedAt;
      if (!latestCommitAt || committedAt > latestCommitAt) latestCommitAt = committedAt;
    }

    const author = String(commit.author_name || commit.authorName || "").trim();
    if (author) authors.add(author);

    const commitFiles = Array.isArray(commit.files) ? commit.files : [];
    commitFiles.forEach((file) => {
      const filename = String(file.filename || "").trim();
      if (filename) files.add(filename);
      additions += Number(file.additions || 0);
      deletions += Number(file.deletions || 0);
    });
  });

  return {
    totalCommits: filtered.length,
    uniqueAuthors: authors.size,
    filesTouched: files.size,
    additions,
    deletions,
    firstCommitAt,
    latestCommitAt
  };
}

function buildChangelog(commits, options = {}) {
  const filtered = filterByDays(Array.isArray(commits) ? commits : [], options.days);

  const groups = {
    features: [],
    fixes: [],
    other: []
  };

  filtered.forEach((commit) => {
    const files = Array.isArray(commit.files) ? commit.files : [];
    const totals = files.reduce(
      (acc, file) => {
        acc.additions += Number(file.additions || 0);
        acc.deletions += Number(file.deletions || 0);
        return acc;
      },
      { additions: 0, deletions: 0 }
    );

    const entry = {
      sha: String(commit.sha || ""),
      branch: String(commit.branch || ""),
      message: String(commit.message || "").trim() || "(no message)",
      authorName: String(commit.author_name || commit.authorName || "Unknown author"),
      committedAt: toIsoTime(commit.committed_at || commit.committedAt),
      filesChanged: files.length,
      additions: totals.additions,
      deletions: totals.deletions
    };

    const bucket = classifyCommitMessage(entry.message);
    groups[bucket].push(entry);
  });

  Object.keys(groups).forEach((key) => {
    groups[key].sort((a, b) => String(b.committedAt || "").localeCompare(String(a.committedAt || "")));
  });

  return {
    totalEntries: groups.features.length + groups.fixes.length + groups.other.length,
    groups
  };
}

module.exports = {
  buildRepositorySummary,
  buildChangelog
};
