const githubDataStore = require("./githubDataStore");
const githubAiPlanStore = require("./githubAiPlanStore");
const projectStateService = require("./projectStateService");

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";

function safeText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function toList(value, maxItems = 10) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item, 240)).filter(Boolean).slice(0, maxItems);
}

function summarizeCommitFile(file) {
  return {
    filename: safeText(file?.filename, 260),
    status: safeText(file?.status, 24),
    additions: Number(file?.additions || 0),
    deletions: Number(file?.deletions || 0),
    patchPreview: safeText(file?.patch, 450)
  };
}

function buildCommitContext(commits) {
  const safeCommits = Array.isArray(commits) ? commits : [];
  const totalAdditions = safeCommits.reduce(
    (sum, commit) => sum + (Array.isArray(commit.files) ? commit.files.reduce((s, file) => s + Number(file.additions || 0), 0) : 0),
    0
  );
  const totalDeletions = safeCommits.reduce(
    (sum, commit) => sum + (Array.isArray(commit.files) ? commit.files.reduce((s, file) => s + Number(file.deletions || 0), 0) : 0),
    0
  );

  return {
    commitCount: safeCommits.length,
    totalAdditions,
    totalDeletions,
    commits: safeCommits.slice(0, 20).map((commit) => ({
      sha: safeText(commit.sha, 80),
      message: safeText(commit.message, 400),
      authorName: safeText(commit.author_name || commit.authorName, 120),
      committedAt: safeText(commit.committed_at || commit.committedAt, 64),
      files: (Array.isArray(commit.files) ? commit.files : []).slice(0, 15).map(summarizeCommitFile)
    }))
  };
}

function inferHeuristicAnalysis({ repository, project, description, commitContext }) {
  const text = [
    safeText(repository?.name, 120),
    safeText(repository?.full_name, 160),
    safeText(project?.title, 180),
    safeText(project?.summary, 500),
    safeText(description, 1000),
    commitContext.commits.map((item) => item.message).join(" ")
  ]
    .join(" ")
    .toLowerCase();

  let projectType = "Software Project";
  if (text.includes("api") || text.includes("backend") || text.includes("server")) {
    projectType = "Backend/API Project";
  } else if (text.includes("frontend") || text.includes("ui") || text.includes("html") || text.includes("css")) {
    projectType = "Frontend/Web App Project";
  } else if (text.includes("mobile") || text.includes("android") || text.includes("ios")) {
    projectType = "Mobile App Project";
  }

  const deliverables = [
    "Working implementation of committed features",
    "Updated project timeline for remaining tasks",
    "Verification checklist for recent code changes"
  ];

  const inferredFeaturesAdded = commitContext.commits
    .map((item) => item.message)
    .filter(Boolean)
    .slice(0, 6);

  const timelineSuggestions = inferredFeaturesAdded.slice(0, 5).map((message, idx) => ({
    task: `Validate and finalize: ${message}`,
    owner: String(project?.ownerUsername || "Team"),
    due: `+${idx + 2} days`,
    reason: "Derived from latest commit activity"
  }));

  return {
    projectType,
    deliverables,
    inferredFeaturesAdded,
    timelineSuggestions,
    summary: `Detected ${commitContext.commitCount} recent commit(s) with net code delta ${commitContext.totalAdditions} additions and ${commitContext.totalDeletions} deletions.`,
    confidence: 0.62
  };
}

function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_err) {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_err) {
    return null;
  }
}

async function callClaudeAnalysis(context) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return null;
  if (typeof fetch !== "function") return null;

  const prompt = [
    "Analyze repository updates and return strict JSON only.",
    "JSON schema:",
    "{",
    '  "projectType": "string",',
    '  "deliverables": ["string"],',
    '  "inferredFeaturesAdded": ["string"],',
    '  "timelineSuggestions": [{"task":"string","owner":"string","due":"string","reason":"string"}],',
    '  "summary": "string",',
    '  "confidence": 0.0',
    "}",
    "Keep response concise, practical, and based on the commit diffs.",
    "Context:",
    JSON.stringify(context)
  ].join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const text = Array.isArray(data?.content)
      ? data.content.map((item) => safeText(item?.text, 6000)).join("\n")
      : "";

    const parsed = extractJsonObject(text);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function normalizeAnalysis(raw, fallback) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    projectType: safeText(source.projectType || fallback.projectType, 140),
    deliverables: toList(source.deliverables, 10).length
      ? toList(source.deliverables, 10)
      : fallback.deliverables,
    inferredFeaturesAdded: toList(source.inferredFeaturesAdded, 12).length
      ? toList(source.inferredFeaturesAdded, 12)
      : fallback.inferredFeaturesAdded,
    timelineSuggestions: Array.isArray(source.timelineSuggestions) && source.timelineSuggestions.length
      ? source.timelineSuggestions.slice(0, 20).map((item) => ({
          task: safeText(item?.task, 180),
          owner: safeText(item?.owner, 120),
          due: safeText(item?.due, 80),
          reason: safeText(item?.reason, 220)
        })).filter((item) => item.task)
      : fallback.timelineSuggestions,
    summary: safeText(source.summary || fallback.summary, 1000),
    confidence: Math.max(0, Math.min(1, Number(source.confidence || fallback.confidence || 0.5)))
  };
}

function buildConfirmationPrompt(analysis) {
  const deliverables = analysis.deliverables.slice(0, 3).map((item) => `- ${item}`).join("\n");
  return [
    `Detected project type: ${analysis.projectType}`,
    "Proposed deliverables:",
    deliverables || "- No deliverables inferred",
    "\nShould these updates be applied to timeline/features? Reply with: apply or revise."
  ].join("\n");
}

async function createPlanForRepository(input) {
  const repository = input.repository;
  if (!repository || !repository.id) return null;

  const branch = String(input.branch || repository.default_branch || "main");
  const commits = githubDataStore.listCommitsForRepository(repository.id, {
    branch,
    limit: Math.max(1, Math.min(50, Number(input.commitLimit || 12)))
  });

  const allowedShas = new Set(
    (Array.isArray(input.sourceCommitShas) ? input.sourceCommitShas : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  );

  const candidateCommits = commits
    .filter((commit) => String(commit.message || "").trim())
    .filter((commit) => !allowedShas.size || allowedShas.has(String(commit.sha || "")));

  if (!candidateCommits.length) return null;

  const project = projectStateService.findProjectForRepository(repository);
  const description = safeText(input.projectDescription || project?.summary || project?.gitNotes || "", 1600);
  const commitContext = buildCommitContext(candidateCommits);

  const context = {
    repository: {
      owner: repository.owner,
      name: repository.name,
      fullName: repository.full_name,
      defaultBranch: repository.default_branch
    },
    project: project
      ? {
          id: project.id,
          title: project.title,
          summary: project.summary,
          ownerUsername: project.ownerUsername,
          timeline: Array.isArray(project.timeline) ? project.timeline.slice(0, 12) : []
        }
      : null,
    projectDescription: description,
    commitContext
  };

  const heuristic = inferHeuristicAnalysis({ repository, project, description, commitContext });
  const claude = await callClaudeAnalysis(context);
  const analysis = normalizeAnalysis(claude, heuristic);
  const confirmationPrompt = buildConfirmationPrompt(analysis);

  return githubAiPlanStore.createPlan({
    repositoryId: repository.id,
    installationId: repository.installation_id,
    projectId: project?.id || 0,
    createdBy: String(input.createdBy || "system"),
    trigger: String(input.trigger || "manual"),
    status: "pending_confirmation",
    provider: "claude",
    model: claude ? DEFAULT_MODEL : "heuristic-fallback",
    sourceCommitShas: candidateCommits.slice(0, 20).map((item) => String(item.sha || "")),
    projectDescription: description,
    confirmationPrompt,
    analysis
  });
}

function getLatestPlanForRepository(repositoryId) {
  const plans = githubAiPlanStore.listPlansForRepository(repositoryId, { limit: 1 });
  return plans[0] || null;
}

function getPlanById(planId) {
  return githubAiPlanStore.getPlanById(planId);
}

function applyPlan(planId, username) {
  const plan = githubAiPlanStore.getPlanById(planId);
  if (!plan) {
    throw new Error("AI plan not found");
  }

  if (String(plan.status || "") === "applied") {
    throw new Error("AI plan already applied");
  }

  const project = projectStateService.applyPlanToProject(plan, { username });

  const updatedPlan = githubAiPlanStore.updatePlan(plan.id, {
    status: "applied",
    appliedMeta: {
      appliedBy: String(username || "system"),
      appliedAt: new Date().toISOString(),
      resultingProjectId: Number(project.id) || 0
    }
  });

  return { plan: updatedPlan, project };
}

module.exports = {
  createPlanForRepository,
  getLatestPlanForRepository,
  getPlanById,
  applyPlan
};
