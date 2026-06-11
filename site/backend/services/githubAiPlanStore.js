const store = require("./lmdbStore");

const KEY = "github:ai-plans";

function nowIso() {
  return new Date().toISOString();
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function createState() {
  return {
    nextPlanId: 1,
    plans: []
  };
}

function loadState() {
  const state = store.get(KEY);
  if (!state || typeof state !== "object" || !Array.isArray(state.plans)) {
    const fresh = createState();
    store.putSync(KEY, fresh);
    return fresh;
  }

  if (!Number.isFinite(Number(state.nextPlanId)) || Number(state.nextPlanId) <= 0) {
    const maxId = state.plans.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
    state.nextPlanId = maxId + 1;
  }

  return state;
}

function saveState(state) {
  store.putSync(KEY, state);
}

function createPlan(input) {
  const state = loadState();
  const timestamp = nowIso();

  const plan = {
    id: state.nextPlanId++,
    repositoryId: Number(input.repositoryId) || 0,
    installationId: Number(input.installationId) || 0,
    projectId: Number(input.projectId) || 0,
    createdBy: String(input.createdBy || "system"),
    trigger: String(input.trigger || "manual"),
    status: String(input.status || "pending_confirmation"),
    provider: String(input.provider || "claude"),
    model: String(input.model || ""),
    sourceCommitShas: Array.isArray(input.sourceCommitShas)
      ? input.sourceCommitShas.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    projectDescription: String(input.projectDescription || ""),
    confirmationPrompt: String(input.confirmationPrompt || ""),
    analysis: input.analysis && typeof input.analysis === "object" ? copy(input.analysis) : {},
    appliedMeta: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.plans.push(plan);
  saveState(state);
  return copy(plan);
}

function listPlansForRepository(repositoryId, options = {}) {
  const state = loadState();
  const safeRepoId = Number(repositoryId);
  const status = String(options.status || "").trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));

  return state.plans
    .filter((plan) => Number(plan.repositoryId) === safeRepoId)
    .filter((plan) => !status || String(plan.status || "") === status)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || Number(b.id) - Number(a.id))
    .slice(0, limit)
    .map(copy);
}

function getPlanById(planId) {
  const state = loadState();
  const safeId = Number(planId);
  const plan = state.plans.find((item) => Number(item.id) === safeId);
  return plan ? copy(plan) : null;
}

function updatePlan(planId, updates) {
  const state = loadState();
  const safeId = Number(planId);
  const index = state.plans.findIndex((item) => Number(item.id) === safeId);
  if (index < 0) return null;

  const next = {
    ...state.plans[index],
    ...copy(updates || {}),
    id: state.plans[index].id,
    updatedAt: nowIso()
  };

  state.plans[index] = next;
  saveState(state);
  return copy(next);
}

module.exports = {
  createPlan,
  listPlansForRepository,
  getPlanById,
  updatePlan
};
