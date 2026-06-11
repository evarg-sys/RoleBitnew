const store = require("./lmdbStore");

function nowIso() {
  return new Date().toISOString();
}

function loadState() {
  const state = store.get("state");
  if (!state || typeof state !== "object" || !Array.isArray(state.projects)) {
    return { nextProjectId: 1, nextInviteId: 1, invitations: [], projects: [] };
  }
  return state;
}

function saveState(state) {
  store.putSync("state", state);
}

function parseGitHubRepoKey(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  const sshMatch = value.match(/^git@github\.com:([^/\s]+)\/([^\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1].toLowerCase()}/${sshMatch[2].replace(/\.git$/i, "").toLowerCase()}`;
  }

  const shorthandMatch = value.match(/^([^/\s]+)\/([^\s]+)$/);
  if (shorthandMatch && !value.startsWith("http")) {
    return `${shorthandMatch[1].toLowerCase()}/${shorthandMatch[2].replace(/\.git$/i, "").toLowerCase()}`;
  }

  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname || "").toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return "";

    const parts = String(parsed.pathname || "")
      .split("/")
      .filter(Boolean);

    if (parts.length < 2) return "";
    const owner = String(parts[0] || "").toLowerCase();
    const repo = String(parts[1] || "").replace(/\.git$/i, "").toLowerCase();
    if (!owner || !repo) return "";
    return `${owner}/${repo}`;
  } catch (_err) {
    return "";
  }
}

function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];

  return timeline
    .filter((item) => item && item.task)
    .map((item, index) => ({
      id: Number(item.id) || index + 1,
      task: String(item.task || ""),
      owner: String(item.owner || ""),
      due: String(item.due || ""),
      completed: Boolean(item.completed),
      completedBy: String(item.completedBy || "")
    }));
}

function findProjectForRepository(repository) {
  const state = loadState();
  const repoKeys = new Set([
    parseGitHubRepoKey(repository?.full_name),
    parseGitHubRepoKey(repository?.html_url),
    parseGitHubRepoKey(`${repository?.owner || ""}/${repository?.name || ""}`)
  ].filter(Boolean));

  if (!repoKeys.size) return null;

  const project = state.projects.find((item) => repoKeys.has(parseGitHubRepoKey(item.gitRepoUrl || "")));
  if (!project) return null;
  return JSON.parse(JSON.stringify(project));
}

function appendFeatureNotes(project, features) {
  const safeFeatures = Array.isArray(features)
    ? features.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  if (!safeFeatures.length) return String(project.gitNotes || "").trim();

  const existing = String(project.gitNotes || "").trim();
  const sectionHeader = "AI Feature Updates:";
  const existingLines = existing.split("\n").map((line) => line.trim()).filter(Boolean);
  const existingLower = new Set(existingLines.map((line) => line.toLowerCase()));

  const additions = safeFeatures
    .map((feature) => `- ${feature}`)
    .filter((line) => !existingLower.has(line.toLowerCase()));

  if (!additions.length) return existing;
  const base = existing ? `${existing}\n\n${sectionHeader}` : sectionHeader;
  return `${base}\n${additions.join("\n")}`;
}

function applyPlanToProject(plan, options = {}) {
  const state = loadState();
  const projectId = Number(plan?.projectId || 0);
  if (!projectId) {
    throw new Error("AI plan is not linked to a project");
  }

  const index = state.projects.findIndex((item) => Number(item.id) === projectId);
  if (index < 0) {
    throw new Error("Linked project no longer exists");
  }

  const existing = state.projects[index];
  const actor = String(options.username || "").trim();
  if (actor && String(existing.ownerUsername || "").toLowerCase() !== actor.toLowerCase()) {
    throw new Error("Only the project owner can apply AI updates");
  }

  const timelineSuggestions = Array.isArray(plan?.analysis?.timelineSuggestions)
    ? plan.analysis.timelineSuggestions
    : [];
  const featureList = Array.isArray(plan?.analysis?.inferredFeaturesAdded)
    ? plan.analysis.inferredFeaturesAdded
    : [];

  const timeline = normalizeTimeline(existing.timeline);
  const existingTasks = new Set(timeline.map((item) => String(item.task || "").trim().toLowerCase()));
  let nextId = timeline.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

  timelineSuggestions.slice(0, 20).forEach((item) => {
    const task = String(item?.task || "").trim();
    if (!task) return;
    if (existingTasks.has(task.toLowerCase())) return;

    timeline.push({
      id: nextId++,
      task,
      owner: String(item?.owner || existing.ownerUsername || "").trim(),
      due: String(item?.due || "").trim(),
      completed: false,
      completedBy: ""
    });
    existingTasks.add(task.toLowerCase());
  });

  const updated = {
    ...existing,
    timeline,
    gitNotes: appendFeatureNotes(existing, featureList),
    updatedAt: nowIso()
  };

  state.projects[index] = updated;
  saveState(state);
  return JSON.parse(JSON.stringify(updated));
}

module.exports = {
  findProjectForRepository,
  applyPlanToProject
};
