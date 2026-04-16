const githubAppService = require("../services/githubAppService");
const githubDataStore = require("../services/githubDataStore");
const githubWebhookService = require("../services/githubWebhookService");
const { resolveUsername } = require("../middleware/auth");

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(value) {
  if (!value) return null;
  try {
    const text = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function mapRepoOutput(repo) {
  return {
    id: repo.id,
    installationId: repo.installation_id,
    githubRepoId: repo.github_repo_id,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
    htmlUrl: repo.html_url,
    installation: repo.installation
      ? {
          id: repo.installation.id,
          githubInstallationId: repo.installation.github_installation_id,
          githubAccountLogin: repo.installation.github_account_login,
          githubAccountType: repo.installation.github_account_type,
          userId: repo.installation.user_id,
          workspaceId: repo.installation.workspace_id,
          projectId: repo.installation.project_id
        }
      : null
  };
}

function mapCommitOutput(commit) {
  return {
    id: commit.id,
    repositoryId: commit.repository_id,
    sha: commit.sha,
    branch: commit.branch,
    message: commit.message,
    authorName: commit.author_name,
    authorEmail: commit.author_email,
    authorAvatarUrl: commit.author_avatar_url,
    committedAt: commit.committed_at,
    compareUrl: commit.compare_url,
    createdAt: commit.created_at,
    files: Array.isArray(commit.files)
      ? commit.files.map((file) => ({
          id: file.id,
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch
        }))
      : []
  };
}

function getScope(req, fallbackUser) {
  return {
    userId: fallbackUser || req.authUser || resolveUsername(req),
    workspaceId: req.query.workspaceId || req.body?.workspaceId || "",
    projectId: req.query.projectId || req.body?.projectId || ""
  };
}

async function getInstallUrl(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const state = encodeState({
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      issuedAt: Date.now()
    });

    const installUrl = githubAppService.buildInstallUrl(state);
    return res.json({ installUrl, state });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not generate install URL" });
  }
}

async function handleCallback(req, res) {
  try {
    const installationId = Number(req.query.installation_id || 0);
    if (!installationId) {
      return res.status(400).json({ error: "installation_id is required" });
    }

    const setupAction = String(req.query.setup_action || "install");
    const decoded = decodeState(String(req.query.state || "")) || {};
    const userId = String(decoded.userId || resolveUsername(req) || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "Missing user context in callback state" });
    }

    const details = await githubAppService.getInstallationDetails(installationId);

    const installation = githubDataStore.upsertInstallation({
      userId,
      workspaceId: decoded.workspaceId || "",
      projectId: decoded.projectId || "",
      githubInstallationId: installationId,
      githubAccountLogin: details.account?.login || "",
      githubAccountType: details.account?.type || ""
    });

    if (setupAction !== "request") {
      const repositories = await githubAppService.listInstallationRepositories(installationId);
      repositories.forEach((repo) => {
        githubDataStore.upsertRepository({
          installationId: installation.id,
          githubRepoId: repo.id,
          owner: repo.owner?.login || "",
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          private: repo.private,
          htmlUrl: repo.html_url
        });
      });
    }

    const appBase = process.env.APP_BASE_URL || "";
    if (appBase) {
      const callbackUrl = new URL(`${appBase.replace(/\/$/, "")}/frontend/project-detail.html`);
      if (decoded.projectId) callbackUrl.searchParams.set("projectId", String(decoded.projectId));
      callbackUrl.searchParams.set("githubConnected", "1");
      return res.redirect(callbackUrl.toString());
    }

    return res.json({ success: true, installationId, userId, setupAction });
  } catch (err) {
    return res.status(500).json({ error: err.message || "GitHub callback failed" });
  }
}

async function listRepos(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repos = githubDataStore.listRepositoriesForScope(scope).map(mapRepoOutput);
    return res.json({ repositories: repos });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load repositories" });
  }
}

async function listRepoCommits(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const commits = githubDataStore
      .listCommitsForRepository(repoId, {
        branch: req.query.branch || "",
        limit: req.query.limit || 25
      })
      .map(mapCommitOutput);

    return res.json({ commits });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load commits" });
  }
}

async function syncRepo(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const installation = repo.installation;
    const branch = String(req.body?.branch || repo.default_branch || "main");

    const commits = await githubAppService.listRepositoryCommits(
      installation.github_installation_id,
      repo.owner,
      repo.name,
      branch
    );

    let synced = 0;

    for (const commitRef of commits) {
      const sha = String(commitRef.sha || "").trim();
      if (!sha) continue;

      const detail = await githubAppService.getCommitDetails(
        installation.github_installation_id,
        repo.owner,
        repo.name,
        sha
      );

      const savedCommit = githubDataStore.upsertCommit({
        repositoryId: repo.id,
        sha,
        branch,
        message: String(detail.commit?.message || commitRef.commit?.message || ""),
        authorName: String(detail.commit?.author?.name || detail.author?.login || ""),
        authorEmail: String(detail.commit?.author?.email || ""),
        authorAvatarUrl: String(detail.author?.avatar_url || ""),
        committedAt: String(detail.commit?.author?.date || ""),
        compareUrl: String(detail.html_url || ""),
        rawPayloadJson: JSON.stringify(detail)
      });

      githubDataStore.upsertCommitFiles(
        savedCommit.id,
        Array.isArray(detail.files)
          ? detail.files.map((file) => ({
              filename: file.filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              patch: file.patch || ""
            }))
          : []
      );

      synced += 1;
    }

    return res.json({ success: true, synced });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to sync repository" });
  }
}

async function disconnectRepo(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const removed = githubDataStore.removeRepository(repo.id);
    return res.json({ success: removed });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to disconnect repository" });
  }
}

async function webhook(req, res) {
  const event = String(req.headers["x-github-event"] || "");

  try {
    if (event === "push") {
      await githubWebhookService.handlePushEvent(req.body);
    } else if (event === "installation") {
      await githubWebhookService.handleInstallationEvent(req.body);
    } else if (event === "installation_repositories") {
      await githubWebhookService.handleInstallationRepositoriesEvent(req.body);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("GitHub webhook processing failed:", err?.message || err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

module.exports = {
  getInstallUrl,
  handleCallback,
  listRepos,
  listRepoCommits,
  syncRepo,
  disconnectRepo,
  webhook
};
