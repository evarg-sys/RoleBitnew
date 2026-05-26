(function () {
  const API_BASE = "http://localhost:3000/api/github";

  function getUser() {
    return localStorage.getItem("rolebit_user") || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWhen(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  async function apiRequest(path, options = {}) {
    const user = getUser();
    if (!user) throw new Error("Not signed in");

    const url = new URL(`${API_BASE}${path}`);
    if (!url.searchParams.has("username")) {
      url.searchParams.set("username", user);
    }

    const requestOptions = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        "x-rolebit-user": user
      }
    };

    const response = await fetch(url.toString(), requestOptions);
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const data = await response.json();
        if (data && data.error) message = data.error;
      } catch (_err) {}
      throw new Error(message);
    }

    return response.json();
  }

  function createProjectTemplate() {
    return `
      <div class="github-integration-shell">
        <div class="github-integration-header">
          <h3>Linked GitHub Repos</h3>
          <div class="github-actions">
            <button type="button" class="pill-btn" data-action="connect">Connect GitHub</button>
            <button type="button" class="pill-btn" data-action="refresh-status">Refresh Status</button>
            <button type="button" class="pill-btn" data-action="install">Install GitHub App</button>
          </div>
        </div>
        <div class="github-status" data-role="status">Loading repositories...</div>
        <div class="github-empty" data-role="empty" style="display:none;">No repositories linked yet.</div>
        <div class="github-list" data-role="repos"></div>
        <div class="github-commit-panel" data-role="commits">
          <div class="github-commit-toolbar">
            <select data-role="repo-filter"></select>
            <input data-role="branch-filter" placeholder="Branch (optional)">
            <button type="button" class="pill-btn" data-action="load-commits">Load Commits</button>
          </div>
          <div class="github-commit-list" data-role="commit-list"></div>
        </div>
        <div class="github-insights-panel" data-role="insights">
          <div class="github-commit-toolbar">
            <select data-role="days-filter">
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
              <option value="90">Last 90 days</option>
              <option value="0">All time</option>
            </select>
            <button type="button" class="pill-btn" data-action="load-changelog">Load Changelog</button>
          </div>
          <div class="github-summary" data-role="summary"></div>
          <div class="github-changelog" data-role="changelog"></div>
        </div>
      </div>
    `;
  }

  async function loadInstallUrl(projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const data = await apiRequest(`/install/url${query}`);
    return data.installUrl;
  }

  function renderRepos(container, repos) {
    const list = container.querySelector('[data-role="repos"]');
    const empty = container.querySelector('[data-role="empty"]');
    const filter = container.querySelector('[data-role="repo-filter"]');

    if (!repos.length) {
      list.innerHTML = "";
      empty.style.display = "block";
      filter.innerHTML = "<option value=''>No repositories</option>";
      return;
    }

    empty.style.display = "none";
    filter.innerHTML = repos
      .map((repo) => `<option value="${repo.id}">${escapeHtml(repo.fullName || `${repo.owner}/${repo.name}`)}</option>`)
      .join("");

    list.innerHTML = repos
      .map((repo) => {
        const repoLabel = repo.fullName || `${repo.owner}/${repo.name}`;
        const privateLabel = repo.private ? "Private" : "Public";
        return `
          <article class="github-repo-card" data-repo-id="${repo.id}">
            <div class="github-repo-title">${escapeHtml(repoLabel)}</div>
            <div class="github-repo-meta">${privateLabel} | Default branch: ${escapeHtml(repo.defaultBranch || "main")}</div>
            <div class="github-repo-actions">
              <button type="button" class="pill-btn" data-action="sync" data-repo-id="${repo.id}">Sync now</button>
              <button type="button" class="pill-btn" data-action="disconnect" data-repo-id="${repo.id}">Disconnect</button>
              <a class="pill-btn" href="${escapeHtml(repo.htmlUrl || "#")}" target="_blank" rel="noopener">Open Repo</a>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderCommits(container, commits) {
    const list = container.querySelector('[data-role="commit-list"]');
    if (!commits.length) {
      list.innerHTML = '<div class="github-empty">No commit activity found for this filter.</div>';
      return;
    }

    list.innerHTML = commits
      .map((commit) => {
        const files = Array.isArray(commit.files) ? commit.files : [];
        return `
          <article class="github-commit-card">
            <div class="github-commit-title">${escapeHtml(commit.message || "(no message)")}</div>
            <div class="github-commit-meta">
              ${escapeHtml(commit.authorName || "Unknown author")} | ${escapeHtml(commit.branch || "unknown branch")} | ${escapeHtml(commit.sha || "").slice(0, 12)} | ${escapeHtml(formatWhen(commit.committedAt))}
            </div>
            <div class="github-file-list">
              ${files.length
                ? files
                    .map(
                      (file) =>
                        `<div class="github-file-item">${escapeHtml(file.status)} | ${escapeHtml(file.filename)} (+${Number(file.additions || 0)} / -${Number(file.deletions || 0)})</div>`
                    )
                    .join("")
                : '<div class="github-file-item">No changed files captured.</div>'}
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function loadRepos(projectId, options = {}) {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", String(projectId));
    if (options.refresh) params.set("refresh", "1");
    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await apiRequest(`/repos${query}`);
    return Array.isArray(data.repositories) ? data.repositories : [];
  }

  async function loadInstallations(projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const data = await apiRequest(`/installations${query}`);
    return Array.isArray(data.installations) ? data.installations : [];
  }

  async function loadCommits(repoId, branch) {
    if (!repoId) return [];
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await apiRequest(`/repos/${encodeURIComponent(repoId)}/commits${query}`);
    return Array.isArray(data.commits) ? data.commits : [];
  }

  async function loadSummary(repoId, branch, days) {
    if (!repoId) return null;
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    if (days !== undefined && days !== null) params.set("days", String(days));
    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await apiRequest(`/repos/${encodeURIComponent(repoId)}/summary${query}`);
    return data.summary || null;
  }

  async function loadChangelog(repoId, branch, days) {
    if (!repoId) return null;
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    if (days !== undefined && days !== null) params.set("days", String(days));
    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await apiRequest(`/repos/${encodeURIComponent(repoId)}/changelog${query}`);
    return data.changelog || null;
  }

  function renderSummary(container, summary) {
    const node = container.querySelector('[data-role="summary"]');
    if (!summary) {
      node.innerHTML = '<div class="github-empty">No summary available yet.</div>';
      return;
    }

    node.innerHTML = `
      <div class="github-summary-grid">
        <div class="github-summary-item"><strong>${Number(summary.totalCommits || 0)}</strong><span>Commits</span></div>
        <div class="github-summary-item"><strong>${Number(summary.uniqueAuthors || 0)}</strong><span>Authors</span></div>
        <div class="github-summary-item"><strong>${Number(summary.filesTouched || 0)}</strong><span>Files touched</span></div>
        <div class="github-summary-item"><strong>${Number(summary.additions || 0)}</strong><span>Additions</span></div>
        <div class="github-summary-item"><strong>${Number(summary.deletions || 0)}</strong><span>Deletions</span></div>
      </div>
    `;
  }

  function renderGroup(title, entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    if (!safeEntries.length) {
      return `
        <section class="github-changelog-group">
          <h4>${escapeHtml(title)} (0)</h4>
          <div class="github-empty">No entries</div>
        </section>
      `;
    }

    return `
      <section class="github-changelog-group">
        <h4>${escapeHtml(title)} (${safeEntries.length})</h4>
        ${safeEntries
          .map(
            (entry) => `
              <article class="github-changelog-item">
                <div class="github-commit-title">${escapeHtml(entry.message || "(no message)")}</div>
                <div class="github-commit-meta">${escapeHtml(entry.authorName || "Unknown author")} | ${escapeHtml((entry.sha || "").slice(0, 12))} | ${escapeHtml(formatWhen(entry.committedAt))}</div>
                <div class="github-file-item">Files: ${Number(entry.filesChanged || 0)} | +${Number(entry.additions || 0)} / -${Number(entry.deletions || 0)}</div>
              </article>
            `
          )
          .join("")}
      </section>
    `;
  }

  function renderChangelog(container, changelog) {
    const node = container.querySelector('[data-role="changelog"]');
    if (!changelog || !changelog.groups) {
      node.innerHTML = '<div class="github-empty">No changelog data available yet.</div>';
      return;
    }

    node.innerHTML = [
      renderGroup("Features", changelog.groups.features),
      renderGroup("Fixes", changelog.groups.fixes),
      renderGroup("Other", changelog.groups.other)
    ].join("");
  }

  async function syncRepo(repoId, branch) {
    await apiRequest(`/sync/${encodeURIComponent(repoId)}`, {
      method: "POST",
      body: JSON.stringify({ branch: branch || "" })
    });
  }

  async function disconnectRepo(repoId) {
    await apiRequest(`/repos/${encodeURIComponent(repoId)}`, { method: "DELETE" });
  }

  window.initGithubProjectIntegration = async function initGithubProjectIntegration(options = {}) {
    const container = document.getElementById(options.containerId || "githubIntegrationArea");
    if (!container) return;

    const projectId = options.projectId || "";
    const repoScopeProjectId = "";
    container.innerHTML = createProjectTemplate();

    const status = container.querySelector('[data-role="status"]');
    const branchFilter = container.querySelector('[data-role="branch-filter"]');
    const repoFilter = container.querySelector('[data-role="repo-filter"]');
    const daysFilter = container.querySelector('[data-role="days-filter"]');

    async function refreshRepos(options = {}) {
      status.textContent = "Loading repositories...";
      try {
        const [repos, installations] = await Promise.all([
          loadRepos(repoScopeProjectId, { refresh: Boolean(options.refresh) }),
          loadInstallations(repoScopeProjectId)
        ]);
        renderRepos(container, repos);

        if (repos.length) {
          status.textContent = `Connected repositories: ${repos.length}`;
        } else if (installations.length) {
          const account = installations[0]?.githubAccountLogin || "your GitHub account";
          status.textContent = `GitHub app connected as ${account}, but no repositories have been selected yet.`;
        } else {
          status.textContent = "No GitHub app installation found for this RoleBit account.";
        }
      } catch (err) {
        status.textContent = `Error loading repositories: ${err.message}`;
      }
    }

    async function refreshCommits() {
      status.textContent = "Loading commits...";
      try {
        const commits = await loadCommits(repoFilter.value, branchFilter.value.trim());
        renderCommits(container, commits);
        status.textContent = commits.length ? `Loaded ${commits.length} commits.` : "No commits found.";
      } catch (err) {
        status.textContent = `Error loading commits: ${err.message}`;
      }
    }

    async function refreshInsights() {
      if (!repoFilter.value) {
        renderSummary(container, null);
        renderChangelog(container, null);
        return;
      }

      status.textContent = "Loading changelog insights...";
      try {
        const repoId = repoFilter.value;
        const branch = branchFilter.value.trim();
        const days = Number(daysFilter.value || 30);

        const [summary, changelog] = await Promise.all([
          loadSummary(repoId, branch, days),
          loadChangelog(repoId, branch, days)
        ]);

        renderSummary(container, summary);
        renderChangelog(container, changelog);
        status.textContent = "Changelog insights ready.";
      } catch (err) {
        status.textContent = `Error loading changelog insights: ${err.message}`;
      }
    }

    container.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.getAttribute("data-action");
      const repoId = button.getAttribute("data-repo-id");

      if (action === "connect" || action === "install") {
        try {
          const url = await loadInstallUrl(projectId);
          window.location.href = url;
        } catch (err) {
          status.textContent = `Could not start install flow: ${err.message}`;
        }
        return;
      }

      if (action === "sync" && repoId) {
        status.textContent = "Syncing repository...";
        try {
          await syncRepo(repoId, branchFilter.value.trim());
          await refreshCommits();
          await refreshInsights();
        } catch (err) {
          status.textContent = `Sync failed: ${err.message}`;
        }
        return;
      }

      if (action === "refresh-status") {
        await refreshRepos({ refresh: true });
        await refreshCommits();
        await refreshInsights();
        return;
      }

      if (action === "disconnect" && repoId) {
        status.textContent = "Disconnecting repository...";
        try {
          await disconnectRepo(repoId);
          await refreshRepos();
          renderCommits(container, []);
          renderSummary(container, null);
          renderChangelog(container, null);
        } catch (err) {
          status.textContent = `Disconnect failed: ${err.message}`;
        }
      }

      if (action === "load-commits") {
        await refreshCommits();
      }

      if (action === "load-changelog") {
        await refreshInsights();
      }
    });

    repoFilter.addEventListener("change", async () => {
      await refreshCommits();
      await refreshInsights();
    });

    await refreshRepos();
    await refreshCommits();
    await refreshInsights();
  };

  window.initGithubDashboard = async function initGithubDashboard(options = {}) {
    const container = document.getElementById(options.containerId || "dashboardGithubArea");
    if (!container) return;

    container.innerHTML = `
      <div class="github-dashboard-shell">
        <div class="github-integration-header">
          <h2>Linked GitHub Repos</h2>
          <button class="small-action-btn" type="button" data-action="connect">Connect GitHub</button>
        </div>
        <div class="github-status" data-role="status">Loading linked repositories...</div>
        <div class="github-list" data-role="repos"></div>
        <div class="github-commit-list" data-role="feed"></div>
      </div>
    `;

    const status = container.querySelector('[data-role="status"]');
    const reposNode = container.querySelector('[data-role="repos"]');
    const feedNode = container.querySelector('[data-role="feed"]');

    async function refresh() {
      try {
        const [repos, installations] = await Promise.all([
          loadRepos("", { refresh: true }),
          loadInstallations("")
        ]);
        reposNode.innerHTML = repos.length
          ? repos.map((repo) => `<div class="github-file-item">${escapeHtml(repo.fullName)} | ${escapeHtml(repo.defaultBranch)}</div>`).join("")
          : (installations.length
              ? `<div class="github-empty">GitHub app connected as ${escapeHtml(installations[0]?.githubAccountLogin || "unknown")} but no repositories selected yet.</div>`
              : '<div class="github-empty">No linked repositories yet.</div>');

        const allCommits = [];
        for (const repo of repos.slice(0, 5)) {
          const commits = await loadCommits(repo.id, "");
          commits.slice(0, 3).forEach((commit) => allCommits.push({ ...commit, repoName: repo.fullName }));
        }

        allCommits.sort((a, b) => String(b.committedAt || "").localeCompare(String(a.committedAt || "")));

        feedNode.innerHTML = allCommits.length
          ? allCommits
              .slice(0, 12)
              .map(
                (commit) =>
                  `<div class="github-file-item">${escapeHtml(commit.repoName)} | ${escapeHtml(commit.branch)} | ${escapeHtml(commit.authorName)} | ${escapeHtml(commit.sha).slice(0, 10)} | ${escapeHtml(commit.message)}</div>`
              )
              .join("")
          : '<div class="github-empty">No commit activity available yet.</div>';

        status.textContent = `Linked repositories: ${repos.length}`;
      } catch (err) {
        status.textContent = `Failed to load GitHub activity: ${err.message}`;
      }
    }

    container.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action='connect']");
      if (!button) return;
      try {
        const url = await loadInstallUrl("");
        window.location.href = url;
      } catch (err) {
        status.textContent = `Could not start install flow: ${err.message}`;
      }
    });

    await refresh();
  };
})();
