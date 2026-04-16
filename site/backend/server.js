const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { open } = require("lmdb");

const app = express();
app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, "users.json");
const LMDB_PATH = path.join(__dirname, "rolebit.lmdb");
const LEGACY_SQLITE_PATH = path.join(__dirname, "rolebit.db");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]", "utf8");
}

const store = open({
  path: LMDB_PATH,
  compression: true
});

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMemberList(members, ownerUsername) {
  const set = new Set();

  (Array.isArray(members) ? members : []).forEach((member) => {
    const value = String(member || "").trim();
    if (value) set.add(value);
  });

  const owner = String(ownerUsername || "").trim();
  if (owner) set.add(owner);

  return Array.from(set).sort((a, b) => a.localeCompare(b));
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

function safeProgress(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function createState() {
  return {
    nextProjectId: 1,
    projects: []
  };
}

function loadState() {
  const state = store.get("state");
  if (!state || typeof state !== "object" || !Array.isArray(state.projects)) {
    const fresh = createState();
    store.putSync("state", fresh);
    return fresh;
  }
  return state;
}

function saveState(state) {
  store.putSync("state", state);
}

function projectToResponse(project) {
  return {
    id: project.id,
    title: project.title,
    ownerUsername: project.ownerUsername,
    summary: project.summary,
    status: project.status,
    deadline: project.deadline,
    progress: project.progress,
    visibility: project.visibility,
    team: project.team,
    priority: project.priority,
    risk: project.risk,
    course: project.course || "General Studies",
    gitRepoUrl: project.gitRepoUrl || "",
    gitBranch: project.gitBranch || "main",
    gitNotes: project.gitNotes || "",
    lifecycleStage: project.lifecycleStage || "Planning",
    members: Array.isArray(project.members) ? project.members : [project.ownerUsername],
    timeline: Array.isArray(project.timeline) ? project.timeline : []
  };
}

function canAccessProject(project, username) {
  if (!project || !username) return false;
  if (project.ownerUsername === username) return true;
  if (project.visibility === "shared") return true;
  return (project.members || []).includes(username);
}

function seedProjectsIfEmpty() {
  const state = loadState();
  if (state.projects.length > 0) return;

  const seed = [
    {
      title: "Website Redesign",
      owner: "evarg22",
      summary: "Rebuild the landing and onboarding experience with improved conversion-focused sections.",
      status: "In Progress",
      deadline: "2026-04-22",
      progress: 68,
      visibility: "shared",
      team: "Team: 5 people",
      priority: "Priority: High",
      risk: "Risk: Tight content timeline",
      course: "Computer Science",
      gitRepoUrl: "",
      gitBranch: "main",
      gitNotes: "",
      lifecycleStage: "Execution",
      members: ["evarg22", "Ari", "Nina", "Theo", "Marta"],
      timeline: [
        { id: 1, task: "Finalize hero interaction", owner: "Ari", due: "Apr 18", completed: true, completedBy: "Ari" },
        { id: 2, task: "Approve mobile QA", owner: "Nina", due: "Apr 20", completed: true, completedBy: "Nina" },
        { id: 3, task: "Publish v2 content", owner: "Theo", due: "Apr 22", completed: false, completedBy: "" }
      ]
    },
    {
      title: "API Integration",
      owner: "evarg22",
      summary: "Connect billing, analytics, and user event pipelines into a single service layer.",
      status: "In Progress",
      deadline: "2026-04-27",
      progress: 42,
      visibility: "private",
      team: "Team: 3 people",
      priority: "Priority: Medium",
      risk: "Risk: Payment retries",
      course: "Software Engineering",
      gitRepoUrl: "",
      gitBranch: "main",
      gitNotes: "",
      lifecycleStage: "Execution",
      members: ["evarg22", "Eric", "Marta"],
      timeline: [
        { id: 1, task: "Finish payment webhook", owner: "Eric", due: "Apr 21", completed: true, completedBy: "Eric" },
        { id: 2, task: "Audit API logs", owner: "Marta", due: "Apr 24", completed: false, completedBy: "" },
        { id: 3, task: "Run staging tests", owner: "Devon", due: "Apr 27", completed: false, completedBy: "" }
      ]
    }
  ];

  seed.forEach((item) => {
    const timestamp = nowIso();
    const project = {
      id: state.nextProjectId++,
      title: item.title,
      ownerUsername: item.owner,
      summary: item.summary,
      status: item.status,
      deadline: item.deadline,
      progress: safeProgress(item.progress),
      visibility: item.visibility === "shared" ? "shared" : "private",
      lifecycleStage: item.lifecycleStage || "Planning",
      members: normalizeMemberList(item.members, item.owner),
      team: item.team,
      priority: item.priority,
      risk: item.risk,
      course: item.course,
      gitRepoUrl: item.gitRepoUrl,
      gitBranch: item.gitBranch,
      gitNotes: item.gitNotes,
      timeline: normalizeTimeline(item.timeline),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    state.projects.push(project);
  });

  saveState(state);
}

function migrateFromLegacySqlite() {
  const state = loadState();
  const defaultSeedTitles = new Set(["Website Redesign", "API Integration"]);
  const looksLikeDefaultSeed =
    state.projects.length === 2 &&
    state.projects.every((item) => defaultSeedTitles.has(String(item.title || "")));

  if (state.projects.length > 0 && !looksLikeDefaultSeed) return false;
  if (!fs.existsSync(LEGACY_SQLITE_PATH)) return false;

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (_err) {
    return false;
  }

  let legacyDb;
  try {
    legacyDb = new DatabaseSync(LEGACY_SQLITE_PATH, { readOnly: true });

    const projects = legacyDb.prepare("SELECT * FROM projects ORDER BY id ASC").all();
    if (!projects.length) {
      legacyDb.close();
      return false;
    }

    const timelineRows = legacyDb.prepare("SELECT * FROM project_timeline ORDER BY id ASC").all();
    const memberRows = legacyDb.prepare("SELECT * FROM project_members ORDER BY username ASC").all();

    const timelineMap = new Map();
    timelineRows.forEach((row) => {
      const list = timelineMap.get(row.project_id) || [];
      list.push({
        id: Number(row.id) || list.length + 1,
        task: String(row.task || ""),
        owner: String(row.task_owner || ""),
        due: String(row.due || ""),
        completed: Boolean(row.completed),
        completedBy: String(row.completed_by || "")
      });
      timelineMap.set(row.project_id, list);
    });

    const memberMap = new Map();
    memberRows.forEach((row) => {
      const list = memberMap.get(row.project_id) || [];
      list.push(String(row.username || ""));
      memberMap.set(row.project_id, list);
    });

    const migratedProjects = projects.map((row) => {
      const ownerUsername = String(row.owner_username || "").trim();
      return {
        id: Number(row.id),
        title: String(row.title || "Untitled Project"),
        ownerUsername,
        summary: String(row.summary || ""),
        status: String(row.status || "In Progress"),
        deadline: String(row.deadline || ""),
        progress: safeProgress(row.progress),
        visibility: row.visibility === "shared" ? "shared" : "private",
        lifecycleStage: String(row.lifecycle_stage || "Planning"),
        members: normalizeMemberList(memberMap.get(row.id) || [], ownerUsername),
        team: String(row.team || "Team: 1 person"),
        priority: String(row.priority || "Priority: Medium"),
        risk: String(row.risk || "Risk: None"),
        course: String(row.course || "General Studies"),
        gitRepoUrl: String(row.git_repo_url || ""),
        gitBranch: String(row.git_branch || "main"),
        gitNotes: String(row.git_notes || ""),
        timeline: normalizeTimeline(timelineMap.get(row.id) || []),
        createdAt: row.created_at ? String(row.created_at) : nowIso(),
        updatedAt: row.updated_at ? String(row.updated_at) : nowIso()
      };
    });

    const maxId = migratedProjects.reduce((highest, item) => Math.max(highest, Number(item.id) || 0), 0);
    state.projects = migratedProjects;
    state.nextProjectId = maxId + 1;
    saveState(state);

    legacyDb.close();
    console.log(`Migrated ${migratedProjects.length} project(s) from legacy SQLite to LMDB.`);
    return true;
  } catch (err) {
    if (legacyDb) {
      try {
        legacyDb.close();
      } catch (_ignore) {}
    }
    console.warn("Legacy SQLite migration skipped:", err?.message || err);
    return false;
  }
}

migrateFromLegacySqlite();
seedProjectsIfEmpty();

app.post("/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  const users = readUsers();
  if (users.find((u) => u.username === username)) {
    return res.status(400).json({ error: "User already exists" });
  }

  users.push({ username, password });
  saveUsers(users);
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find((u) => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid login" });
  res.json({ success: true, username });
});

app.get("/users", (_req, res) => {
  const users = readUsers()
    .map((item) => String(item.username || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  res.json({ users });
});

app.get("/projects", (req, res) => {
  const username = String(req.query.username || "").trim();
  if (!username) {
    return res.status(400).json({ error: "username query parameter is required" });
  }

  const state = loadState();
  const projects = state.projects
    .filter((project) => canAccessProject(project, username))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || b.id - a.id)
    .map((project) => projectToResponse(project));

  res.json({ projects });
});

app.get("/projects/:id", (req, res) => {
  const projectId = Number(req.params.id);
  const username = String(req.query.username || "").trim();

  if (!username) {
    return res.status(400).json({ error: "username query parameter is required" });
  }

  const state = loadState();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (!canAccessProject(project, username)) {
    return res.status(403).json({ error: "Access denied" });
  }

  res.json({ project: projectToResponse(project) });
});

app.post("/projects", (req, res) => {
  const {
    username,
    title,
    summary = "",
    status = "In Progress",
    deadline = "",
    progress = 0,
    visibility = "private",
    lifecycleStage = "Planning",
    members = [],
    team = "Team: 1 person",
    priority = "Priority: Medium",
    risk = "Risk: None",
    course = "General Studies",
    gitRepoUrl = "",
    gitBranch = "main",
    gitNotes = "",
    timeline = []
  } = req.body;

  if (!username || !title) {
    return res.status(400).json({ error: "username and title are required" });
  }

  const state = loadState();
  const timestamp = nowIso();

  const normalizedMembers = normalizeMemberList(members, username);
  const resolvedTeam = String(team || "").trim() || `Team: ${normalizedMembers.length} ${normalizedMembers.length === 1 ? "person" : "people"}`;

  const project = {
    id: state.nextProjectId++,
    title: String(title),
    ownerUsername: String(username),
    summary: String(summary),
    status: String(status || "In Progress"),
    deadline: String(deadline || ""),
    progress: safeProgress(progress),
    visibility: visibility === "shared" ? "shared" : "private",
    lifecycleStage: String(lifecycleStage || "Planning"),
    members: normalizedMembers,
    team: resolvedTeam,
    priority: String(priority || "Priority: Medium"),
    risk: String(risk || "Risk: None"),
    course: String(course || "General Studies"),
    gitRepoUrl: String(gitRepoUrl || ""),
    gitBranch: String(gitBranch || "main"),
    gitNotes: String(gitNotes || ""),
    timeline: normalizeTimeline(timeline),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.projects.push(project);
  saveState(state);

  res.json({ success: true, project: projectToResponse(project) });
});

app.put("/projects/:id", (req, res) => {
  const projectId = Number(req.params.id);
  const {
    username,
    title,
    summary,
    status,
    deadline,
    progress,
    visibility,
    lifecycleStage,
    members,
    team,
    priority,
    risk,
    course,
    gitRepoUrl,
    gitBranch,
    gitNotes
  } = req.body;

  const state = loadState();
  const index = state.projects.findIndex((item) => item.id === projectId);
  if (index === -1) return res.status(404).json({ error: "Project not found" });

  const existing = state.projects[index];
  if (!username || existing.ownerUsername !== username) {
    return res.status(403).json({ error: "Only the owner can edit this project" });
  }

  const nextMembers = Array.isArray(members)
    ? normalizeMemberList(members, existing.ownerUsername)
    : normalizeMemberList(existing.members, existing.ownerUsername);

  const updated = {
    ...existing,
    title: String(title || existing.title),
    summary: String(summary || ""),
    status: String(status || "In Progress"),
    deadline: String(deadline || ""),
    progress: safeProgress(progress),
    visibility: visibility === "shared" ? "shared" : "private",
    lifecycleStage: String(lifecycleStage || "Planning"),
    members: nextMembers,
    team: String(team || existing.team || "Team: 1 person"),
    priority: String(priority || "Priority: Medium"),
    risk: String(risk || "Risk: None"),
    course: String(course || "General Studies"),
    gitRepoUrl: String(gitRepoUrl || ""),
    gitBranch: String(gitBranch || "main"),
    gitNotes: String(gitNotes || ""),
    updatedAt: nowIso()
  };

  state.projects[index] = updated;
  saveState(state);

  res.json({ success: true, project: projectToResponse(updated) });
});

app.put("/projects/:id/timeline", (req, res) => {
  const projectId = Number(req.params.id);
  const { username, timeline } = req.body;

  if (!Array.isArray(timeline)) {
    return res.status(400).json({ error: "timeline must be an array" });
  }

  const state = loadState();
  const index = state.projects.findIndex((item) => item.id === projectId);
  if (index === -1) return res.status(404).json({ error: "Project not found" });

  const existing = state.projects[index];
  if (!username || existing.ownerUsername !== username) {
    return res.status(403).json({ error: "Only the owner can edit timeline" });
  }

  const updated = {
    ...existing,
    timeline: normalizeTimeline(timeline),
    updatedAt: nowIso()
  };

  state.projects[index] = updated;
  saveState(state);

  res.json({ success: true, project: projectToResponse(updated) });
});

const server = app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000 (LMDB)");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error("Port 3000 is already in use. Stop the other process or run on a different port.");
    process.exit(1);
    return;
  }

  console.error("Backend failed to start:", err?.message || err);
  process.exit(1);
});
