const store = require("./lmdbStore");

const DEFAULT_STATE = {
  nextInstallationId: 1,
  nextRepositoryId: 1,
  nextCommitId: 1,
  nextFileId: 1,
  installations: [],
  repositories: [],
  commits: [],
  commitFiles: []
};

function nowIso() {
  return new Date().toISOString();
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeScope(scope = {}) {
  return {
    userId: String(scope.userId || "").trim(),
    workspaceId: scope.workspaceId ? String(scope.workspaceId).trim() : "",
    projectId: scope.projectId ? String(scope.projectId).trim() : ""
  };
}

function scopeEquals(installation, scope) {
  const normalized = normalizeScope(scope);
  if (normalized.projectId) {
    return String(installation.project_id || "") === normalized.projectId;
  }
  if (normalized.workspaceId) {
    return String(installation.workspace_id || "") === normalized.workspaceId;
  }
  return String(installation.user_id || "") === normalized.userId;
}

function loadState() {
  const state = store.get("github:data");
  if (!state || typeof state !== "object") {
    store.putSync("github:data", copy(DEFAULT_STATE));
    return copy(DEFAULT_STATE);
  }

  return {
    ...copy(DEFAULT_STATE),
    ...state,
    installations: Array.isArray(state.installations) ? state.installations : [],
    repositories: Array.isArray(state.repositories) ? state.repositories : [],
    commits: Array.isArray(state.commits) ? state.commits : [],
    commitFiles: Array.isArray(state.commitFiles) ? state.commitFiles : []
  };
}

function saveState(state) {
  store.putSync("github:data", state);
}

function upsertInstallation(input) {
  const state = loadState();
  const scope = normalizeScope(input);
  const githubInstallationId = toNumber(input.githubInstallationId);

  if (!githubInstallationId) {
    throw new Error("githubInstallationId is required");
  }

  const existingIndex = state.installations.findIndex((item) =>
    Number(item.github_installation_id) === githubInstallationId && scopeEquals(item, scope)
  );

  const payload = {
    user_id: scope.userId || "",
    workspace_id: scope.workspaceId || "",
    project_id: scope.projectId || "",
    github_installation_id: githubInstallationId,
    github_account_login: String(input.githubAccountLogin || ""),
    github_account_type: String(input.githubAccountType || ""),
    updated_at: nowIso()
  };

  if (existingIndex >= 0) {
    const current = state.installations[existingIndex];
    const next = {
      ...current,
      ...payload,
      id: current.id,
      created_at: current.created_at || nowIso()
    };
    state.installations[existingIndex] = next;
    saveState(state);
    return copy(next);
  }

  const nextInstallation = {
    id: state.nextInstallationId++,
    ...payload,
    created_at: nowIso()
  };

  state.installations.push(nextInstallation);
  saveState(state);
  return copy(nextInstallation);
}

function listInstallationsByGithubId(githubInstallationId) {
  const state = loadState();
  return state.installations
    .filter((item) => Number(item.github_installation_id) === Number(githubInstallationId))
    .map(copy);
}

function listInstallationsForScope(scope) {
  const state = loadState();
  const normalized = normalizeScope(scope);
  return state.installations
    .filter((item) => {
      if (!normalized.userId) return false;
      if (normalized.projectId) return String(item.project_id || "") === normalized.projectId;
      if (normalized.workspaceId) return String(item.workspace_id || "") === normalized.workspaceId;
      return String(item.user_id || "") === normalized.userId;
    })
    .map(copy);
}

function upsertRepository(input) {
  const state = loadState();
  const installationId = toNumber(input.installationId);
  const githubRepoId = toNumber(input.githubRepoId);

  if (!installationId || !githubRepoId) {
    throw new Error("installationId and githubRepoId are required");
  }

  const existingIndex = state.repositories.findIndex((item) =>
    Number(item.installation_id) === installationId && Number(item.github_repo_id) === githubRepoId
  );

  const payload = {
    installation_id: installationId,
    github_repo_id: githubRepoId,
    owner: String(input.owner || ""),
    name: String(input.name || ""),
    full_name: String(input.fullName || ""),
    default_branch: String(input.defaultBranch || "main"),
    private: Boolean(input.private),
    html_url: String(input.htmlUrl || ""),
    updated_at: nowIso()
  };

  if (existingIndex >= 0) {
    const current = state.repositories[existingIndex];
    const next = {
      ...current,
      ...payload,
      id: current.id,
      created_at: current.created_at || nowIso()
    };
    state.repositories[existingIndex] = next;
    saveState(state);
    return copy(next);
  }

  const repository = {
    id: state.nextRepositoryId++,
    ...payload,
    created_at: nowIso()
  };

  state.repositories.push(repository);
  saveState(state);
  return copy(repository);
}

function removeRepository(repositoryId) {
  const state = loadState();
  const repoId = Number(repositoryId);

  const before = state.repositories.length;
  state.repositories = state.repositories.filter((repo) => Number(repo.id) !== repoId);

  const commitIds = state.commits.filter((c) => Number(c.repository_id) === repoId).map((c) => Number(c.id));
  const commitIdSet = new Set(commitIds);
  state.commits = state.commits.filter((c) => Number(c.repository_id) !== repoId);
  state.commitFiles = state.commitFiles.filter((f) => !commitIdSet.has(Number(f.commit_id)));

  const removed = before - state.repositories.length;
  saveState(state);
  return removed > 0;
}

function removeRepositoryByGithubRepoId(installationId, githubRepoId) {
  const state = loadState();
  const repo = state.repositories.find((item) =>
    Number(item.installation_id) === Number(installationId) && Number(item.github_repo_id) === Number(githubRepoId)
  );

  if (!repo) return false;
  return removeRepository(repo.id);
}

function listRepositoriesForScope(scope) {
  const state = loadState();
  const installations = listInstallationsForScope(scope);
  const installationIds = new Set(installations.map((item) => Number(item.id)));

  return state.repositories
    .filter((repo) => installationIds.has(Number(repo.installation_id)))
    .map((repo) => {
      const installation = installations.find((inst) => Number(inst.id) === Number(repo.installation_id));
      return copy({ ...repo, installation });
    });
}

function getRepositoryForScope(repositoryId, scope) {
  const repos = listRepositoriesForScope(scope);
  return repos.find((repo) => Number(repo.id) === Number(repositoryId)) || null;
}

function upsertCommit(input) {
  const state = loadState();
  const repositoryId = toNumber(input.repositoryId);
  const sha = String(input.sha || "").trim();

  if (!repositoryId || !sha) {
    throw new Error("repositoryId and sha are required");
  }

  const existingIndex = state.commits.findIndex((item) =>
    Number(item.repository_id) === repositoryId && String(item.sha) === sha
  );

  const payload = {
    repository_id: repositoryId,
    sha,
    branch: String(input.branch || ""),
    message: String(input.message || ""),
    author_name: String(input.authorName || ""),
    author_email: String(input.authorEmail || ""),
    author_avatar_url: String(input.authorAvatarUrl || ""),
    committed_at: String(input.committedAt || ""),
    compare_url: String(input.compareUrl || ""),
    raw_payload_json: String(input.rawPayloadJson || "{}")
  };

  if (existingIndex >= 0) {
    const current = state.commits[existingIndex];
    const next = {
      ...current,
      ...payload,
      id: current.id,
      created_at: current.created_at || nowIso()
    };
    state.commits[existingIndex] = next;
    saveState(state);
    return copy(next);
  }

  const commit = {
    id: state.nextCommitId++,
    ...payload,
    created_at: nowIso()
  };

  state.commits.push(commit);
  saveState(state);
  return copy(commit);
}

function upsertCommitFiles(commitId, files = []) {
  const state = loadState();
  const safeCommitId = Number(commitId);
  if (!safeCommitId) return [];

  const upserted = [];
  files.forEach((file) => {
    const filename = String(file.filename || "").trim();
    if (!filename) return;

    const existingIndex = state.commitFiles.findIndex((item) =>
      Number(item.commit_id) === safeCommitId && String(item.filename) === filename
    );

    const payload = {
      commit_id: safeCommitId,
      filename,
      status: String(file.status || "modified"),
      additions: Number(file.additions || 0),
      deletions: Number(file.deletions || 0),
      changes: Number(file.changes || 0),
      patch: String(file.patch || "")
    };

    if (existingIndex >= 0) {
      const current = state.commitFiles[existingIndex];
      const next = {
        ...current,
        ...payload,
        id: current.id,
        created_at: current.created_at || nowIso()
      };
      state.commitFiles[existingIndex] = next;
      upserted.push(copy(next));
      return;
    }

    const created = {
      id: state.nextFileId++,
      ...payload,
      created_at: nowIso()
    };
    state.commitFiles.push(created);
    upserted.push(copy(created));
  });

  saveState(state);
  return upserted;
}

function listCommitsForRepository(repositoryId, options = {}) {
  const state = loadState();
  const safeRepoId = Number(repositoryId);
  const branch = String(options.branch || "").trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));

  const filtered = state.commits
    .filter((item) => Number(item.repository_id) === safeRepoId)
    .filter((item) => !branch || String(item.branch || "") === branch)
    .sort((a, b) => String(b.committed_at || "").localeCompare(String(a.committed_at || "")) || Number(b.id) - Number(a.id))
    .slice(0, limit)
    .map((commit) => {
      const files = state.commitFiles.filter((file) => Number(file.commit_id) === Number(commit.id)).map(copy);
      return copy({ ...commit, files });
    });

  return filtered;
}

module.exports = {
  upsertInstallation,
  listInstallationsByGithubId,
  listInstallationsForScope,
  upsertRepository,
  removeRepository,
  removeRepositoryByGithubRepoId,
  listRepositoriesForScope,
  getRepositoryForScope,
  upsertCommit,
  upsertCommitFiles,
  listCommitsForRepository
};
