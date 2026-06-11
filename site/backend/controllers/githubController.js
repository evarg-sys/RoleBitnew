const githubAppService = require("../services/githubAppService");
const githubDataStore = require("../services/githubDataStore");
const githubWebhookService = require("../services/githubWebhookService");
const githubAnalytics = require("../services/githubAnalytics");
const claudePlanningService = require("../services/claudePlanningService");
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

function mapAiPlanOutput(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    repositoryId: plan.repositoryId,
    installationId: plan.installationId,
    projectId: plan.projectId,
    trigger: plan.trigger,
    status: plan.status,
    provider: plan.provider,
    model: plan.model,
    sourceCommitShas: Array.isArray(plan.sourceCommitShas) ? plan.sourceCommitShas : [],
    projectDescription: plan.projectDescription || "",
    confirmationPrompt: plan.confirmationPrompt || "",
    analysis: plan.analysis || {},
    appliedMeta: plan.appliedMeta || null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
  };
}

function getScope(req, fallbackUser) {
  return {
    userId: fallbackUser || req.authUser || resolveUsername(req),
    workspaceId: req.query.workspaceId || req.body?.workspaceId || "",
    projectId: req.query.projectId || req.body?.projectId || ""
  };
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function parseDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(3650, Math.floor(parsed));
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
    const refreshRequested = ["1", "true", "yes"].includes(
      String(req.query.refresh || "").trim().toLowerCase()
    );

    let repos = githubDataStore.listRepositoriesForScope(scope);
    const installations = githubDataStore.listInstallationsForScope(scope);

    if (!repos.length || refreshRequested) {
      for (const installation of installations) {
        try {
          const repositories = await githubAppService.listInstallationRepositories(
            installation.github_installation_id
          );

          const remoteRepoIds = new Set(
            repositories
              .map((repo) => Number(repo.id))
              .filter((id) => Number.isFinite(id) && id > 0)
          );

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

          if (refreshRequested) {
            const currentRepos = githubDataStore
              .listRepositoriesForScope(scope)
              .filter((repo) => Number(repo.installation_id) === Number(installation.id));

            currentRepos.forEach((repo) => {
              const repoId = Number(repo.github_repo_id);
              if (!remoteRepoIds.has(repoId)) {
                githubDataStore.removeRepositoryByGithubRepoId(installation.id, repoId);
              }
            });
          }
        } catch (_err) {
          // Keep endpoint resilient if one installation cannot be fetched.
        }
      }

      repos = githubDataStore.listRepositoriesForScope(scope);
    }

    const mappedRepos = repos.map(mapRepoOutput);
    return res.json({ repositories: mappedRepos });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load repositories" });
  }
}

async function listInstallations(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const autoLinked = false;
    const installations = githubDataStore.listInstallationsForScope(scope).map((installation) => ({
      id: installation.id,
      githubInstallationId: installation.github_installation_id,
      githubAccountLogin: installation.github_account_login,
      githubAccountType: installation.github_account_type,
      userId: installation.user_id,
      workspaceId: installation.workspace_id,
      projectId: installation.project_id,
      createdAt: installation.created_at,
      updatedAt: installation.updated_at
    }));

    return res.json({ installations, autoLinked });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load installations" });
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

async function getRepoSummary(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const commits = githubDataStore.listCommitsForRepository(repoId, {
      branch: req.query.branch || "",
      limit: parseLimit(req.query.limit, 500, 1000)
    });

    const summary = githubAnalytics.buildRepositorySummary(commits, {
      days: parseDays(req.query.days)
    });

    return res.json({
      repository: mapRepoOutput(repo),
      summary
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to build repository summary" });
  }
}

async function getRepoChangelog(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const commits = githubDataStore.listCommitsForRepository(repoId, {
      branch: req.query.branch || "",
      limit: parseLimit(req.query.limit, 200, 1000)
    });

    const changelog = githubAnalytics.buildChangelog(commits, {
      days: parseDays(req.query.days)
    });

    return res.json({
      repository: mapRepoOutput(repo),
      changelog
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to build repository changelog" });
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
    const syncedShas = [];

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

      syncedShas.push(sha);
      synced += 1;
    }

    let aiPlan = null;
    try {
      aiPlan = await claudePlanningService.createPlanForRepository({
        repository: repo,
        createdBy: scope.userId || "system",
        trigger: "manual_sync",
        branch,
        sourceCommitShas: syncedShas,
        commitLimit: Number(req.body?.commitLimit || 12),
        projectDescription: String(req.body?.projectDescription || "")
      });
    } catch (_err) {
      aiPlan = null;
    }

    return res.json({
      success: true,
      synced,
      aiPlan: mapAiPlanOutput(aiPlan)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to sync repository" });
  }
}

async function analyzeRepoWithClaude(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const plan = await claudePlanningService.createPlanForRepository({
      repository: repo,
      createdBy: scope.userId || "system",
      trigger: "manual_analyze",
      branch: req.body?.branch || req.query.branch || repo.default_branch || "main",
      commitLimit: req.body?.commitLimit || req.query.commitLimit || 12,
      projectDescription: req.body?.projectDescription || "",
      sourceCommitShas: Array.isArray(req.body?.sourceCommitShas) ? req.body.sourceCommitShas : []
    });

    if (!plan) {
      return res.status(400).json({
        error: "No eligible commits found for AI analysis. Make sure commits contain messages and are synced."
      });
    }

    return res.json({
      success: true,
      repository: mapRepoOutput(repo),
      plan: mapAiPlanOutput(plan)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "AI analysis failed" });
  }
}

async function getLatestRepoAiPlan(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const plan = claudePlanningService.getLatestPlanForRepository(repo.id);
    if (!plan) {
      return res.status(404).json({ error: "No AI plans found for this repository" });
    }

    return res.json({
      repository: mapRepoOutput(repo),
      plan: mapAiPlanOutput(plan)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load AI plan" });
  }
}

async function applyRepoAiPlan(req, res) {
  try {
    const scope = getScope(req, req.authUser);
    const repoId = Number(req.params.repoId);
    const planId = Number(req.params.planId);
    const repo = githubDataStore.getRepositoryForScope(repoId, scope);

    if (!repo) {
      return res.status(404).json({ error: "Repository not found for this user/workspace" });
    }

    const plan = claudePlanningService.getPlanById(planId);
    if (!plan || Number(plan.repositoryId) !== Number(repo.id)) {
      return res.status(404).json({ error: "AI plan not found for this repository" });
    }

    const applied = claudePlanningService.applyPlan(planId, scope.userId);
    return res.json({
      success: true,
      repository: mapRepoOutput(repo),
      plan: mapAiPlanOutput(applied.plan),
      project: applied.project
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to apply AI plan" });
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
  listInstallations,
  listRepos,
  listRepoCommits,
  getRepoSummary,
  getRepoChangelog,
  analyzeRepoWithClaude,
  getLatestRepoAiPlan,
  applyRepoAiPlan,
  syncRepo,
  disconnectRepo,
  webhook
};
