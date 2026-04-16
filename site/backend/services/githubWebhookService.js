const githubAppService = require("./githubAppService");
const githubDataStore = require("./githubDataStore");

function normalizeBranch(ref) {
  const value = String(ref || "");
  if (!value.startsWith("refs/heads/")) return value;
  return value.slice("refs/heads/".length);
}

function toCommitPayload(detail, branch, compareUrl) {
  return {
    sha: String(detail.sha || ""),
    branch,
    message: String(detail.commit?.message || ""),
    authorName: String(detail.commit?.author?.name || detail.author?.login || ""),
    authorEmail: String(detail.commit?.author?.email || ""),
    authorAvatarUrl: String(detail.author?.avatar_url || ""),
    committedAt: String(detail.commit?.author?.date || ""),
    compareUrl: String(compareUrl || detail.html_url || ""),
    rawPayloadJson: JSON.stringify(detail)
  };
}

async function syncSingleCommit({ installationId, repository, branch, sha, fallbackCommit }) {
  let detail = null;
  try {
    detail = await githubAppService.getCommitDetails(
      installationId,
      repository.owner,
      repository.name,
      sha
    );
  } catch (err) {
    if (!fallbackCommit) throw err;
  }

  const commitPayload = detail
    ? toCommitPayload(detail, branch, detail.html_url)
    : {
        sha,
        branch,
        message: String(fallbackCommit.message || ""),
        authorName: String(fallbackCommit.author?.name || ""),
        authorEmail: String(fallbackCommit.author?.email || ""),
        authorAvatarUrl: "",
        committedAt: String(fallbackCommit.timestamp || ""),
        compareUrl: String(fallbackCommit.url || ""),
        rawPayloadJson: JSON.stringify(fallbackCommit)
      };

  const commit = githubDataStore.upsertCommit({
    repositoryId: repository.id,
    ...commitPayload
  });

  const files = Array.isArray(detail?.files)
    ? detail.files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch || ""
      }))
    : [];

  githubDataStore.upsertCommitFiles(commit.id, files);
  return commit;
}

async function handlePushEvent(payload) {
  const githubInstallationId = Number(payload?.installation?.id);
  if (!githubInstallationId) return;

  const installationRecords = githubDataStore.listInstallationsByGithubId(githubInstallationId);
  if (!installationRecords.length) return;

  const repoInfo = payload.repository || {};
  const branch = normalizeBranch(payload.ref);
  const commits = Array.isArray(payload.commits) ? payload.commits : [];

  for (const installation of installationRecords) {
    const repository = githubDataStore.upsertRepository({
      installationId: installation.id,
      githubRepoId: Number(repoInfo.id),
      owner: String(repoInfo.owner?.login || repoInfo.full_name?.split("/")[0] || ""),
      name: String(repoInfo.name || ""),
      fullName: String(repoInfo.full_name || ""),
      defaultBranch: String(repoInfo.default_branch || "main"),
      private: Boolean(repoInfo.private),
      htmlUrl: String(repoInfo.html_url || "")
    });

    for (const commit of commits) {
      const sha = String(commit.id || "").trim();
      if (!sha) continue;
      await syncSingleCommit({
        installationId: githubInstallationId,
        repository,
        branch,
        sha,
        fallbackCommit: commit
      });
    }
  }
}

async function handleInstallationEvent(payload) {
  const installation = payload?.installation;
  if (!installation?.id) return;

  const senderLogin = String(payload?.sender?.login || "").trim();

  githubDataStore.upsertInstallation({
    userId: senderLogin || "system",
    workspaceId: "",
    projectId: "",
    githubInstallationId: Number(installation.id),
    githubAccountLogin: String(installation.account?.login || ""),
    githubAccountType: String(installation.account?.type || "")
  });
}

async function handleInstallationRepositoriesEvent(payload) {
  const githubInstallationId = Number(payload?.installation?.id);
  if (!githubInstallationId) return;

  const installationRecords = githubDataStore.listInstallationsByGithubId(githubInstallationId);
  if (!installationRecords.length) return;

  const added = Array.isArray(payload.repositories_added) ? payload.repositories_added : [];
  const removed = Array.isArray(payload.repositories_removed) ? payload.repositories_removed : [];

  for (const installation of installationRecords) {
    for (const repo of added) {
      githubDataStore.upsertRepository({
        installationId: installation.id,
        githubRepoId: Number(repo.id),
        owner: String(repo.owner?.login || repo.full_name?.split("/")[0] || ""),
        name: String(repo.name || ""),
        fullName: String(repo.full_name || ""),
        defaultBranch: String(repo.default_branch || "main"),
        private: Boolean(repo.private),
        htmlUrl: String(repo.html_url || "")
      });
    }

    for (const repo of removed) {
      githubDataStore.removeRepositoryByGithubRepoId(installation.id, Number(repo.id));
    }
  }
}

module.exports = {
  normalizeBranch,
  handlePushEvent,
  handleInstallationEvent,
  handleInstallationRepositoriesEvent
};
