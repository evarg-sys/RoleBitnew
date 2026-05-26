const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

// Load backend env vars for GitHub App integration.
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (_err) {}

const store = require("./services/lmdbStore");
const githubRoutes = require("./routes/github");

const app = express();
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!allowedOrigins.length) {
  allowedOrigins.push(
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  );
}

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS blocked for this origin"));
  }
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(100, Number(process.env.RATE_LIMIT_MAX || 600)),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/github/webhook"
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(5, Number(process.env.AUTH_RATE_LIMIT_MAX || 25)),
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);
app.use(express.json({
  limit: "64kb",
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const USERS_FILE = path.join(__dirname, "users.json");
const LEGACY_SQLITE_PATH = path.join(__dirname, "rolebit.db");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]", "utf8");
}

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

function normalizeUsername(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function usernameKey(value) {
  return normalizeUsername(value).toLowerCase();
}

function textKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeProfileField(value, maxLength = 120) {
  return normalizeText(value).slice(0, maxLength);
}

function normalizeCourseList(value) {
  const rawList = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim());

  const unique = new Set();
  rawList.forEach((item) => {
    const safe = normalizeProfileField(item, 80);
    if (safe) unique.add(safe);
  });

  return Array.from(unique).slice(0, 20);
}

function normalizeProfilePhoto(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const okPrefix = raw.startsWith("data:image/");
  if (!okPrefix) return "";

  // Keep profile photo payload bounded for JSON storage safety.
  if (raw.length > 1_500_000) return "";
  return raw;
}

function findUserRecord(users, username) {
  const target = usernameKey(username);
  if (!target) return null;
  return users.find((item) => usernameKey(item.username) === target) || null;
}

function userToPublicProfile(user) {
  if (!user) return null;

  const enrolledCourses = normalizeCourseList(user.enrolledCourses || user.course || "");
  return {
    username: normalizeUsername(user.username),
    firstName: normalizeProfileField(user.firstName, 80),
    lastName: normalizeProfileField(user.lastName, 80),
    email: normalizeProfileField(user.email, 160),
    university: normalizeProfileField(user.university, 120),
    course: enrolledCourses[0] || "",
    enrolledCourses,
    profilePhoto: normalizeProfilePhoto(user.profilePhoto)
  };
}

function isSameUniversity(leftUser, rightUser) {
  const leftUni = textKey(leftUser?.university);
  const rightUni = textKey(rightUser?.university);

  if (!leftUni || !rightUni) return false;
  return leftUni === rightUni;
}

function formatTeamFromMembers(members) {
  const count = Array.isArray(members) ? members.length : 0;
  return `Team: ${count} ${count === 1 ? "person" : "people"}`;
}

const adminUsernames = new Set(
  String(process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((value) => usernameKey(value))
    .filter(Boolean)
);

function isAdminUsername(value) {
  return adminUsernames.has(usernameKey(value));
}

function isValidUsername(value) {
  const username = normalizeUsername(value);
  return /^[a-zA-Z0-9._-]{3,32}$/.test(username);
}

function isValidPassword(value) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 128;
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

function safePlaintextEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function hashPassword(password) {
  return bcrypt.hash(String(password || ""), 12);
}

async function verifyPassword(storedRecord, incomingPassword) {
  const passwordHash = String(storedRecord?.passwordHash || "");
  if (isBcryptHash(passwordHash)) {
    return bcrypt.compare(String(incomingPassword || ""), passwordHash);
  }

  const legacy = String(storedRecord?.password || "");
  return safePlaintextEqual(legacy, incomingPassword);
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

function parseGitHubRepoKey(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  // Supports URLs like https://github.com/owner/repo(.git) and shorthand owner/repo.
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

function findProjectByRepoKey(state, repoKey, ignoreProjectId = null) {
  if (!repoKey) return null;
  const ignoreId = Number(ignoreProjectId) || null;

  return state.projects.find((project) => {
    if (ignoreId && Number(project.id) === ignoreId) return false;
    return parseGitHubRepoKey(project.gitRepoUrl) === repoKey;
  }) || null;
}

function dedupeProjectsByRepoLink() {
  const state = loadState();
  if (!Array.isArray(state.projects) || !state.projects.length) return 0;

  const bestByKey = new Map();

  state.projects.forEach((project) => {
    const repoKey = parseGitHubRepoKey(project.gitRepoUrl);
    if (!repoKey) return;

    const key = repoKey;
    const updated = Date.parse(String(project.updatedAt || ""));
    const created = Date.parse(String(project.createdAt || ""));

    const rank = {
      updatedAt: Number.isFinite(updated) ? updated : 0,
      createdAt: Number.isFinite(created) ? created : 0,
      id: Number(project.id) || 0
    };

    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, { id: Number(project.id), rank });
      return;
    }

    const isBetter =
      rank.updatedAt > existing.rank.updatedAt ||
      (rank.updatedAt === existing.rank.updatedAt && rank.createdAt > existing.rank.createdAt) ||
      (rank.updatedAt === existing.rank.updatedAt && rank.createdAt === existing.rank.createdAt && rank.id > existing.rank.id);

    if (isBetter) {
      bestByKey.set(key, { id: Number(project.id), rank });
    }
  });

  const keepIds = new Set(Array.from(bestByKey.values()).map((item) => Number(item.id)));
  const before = state.projects.length;

  state.projects = state.projects.filter((project) => {
    const repoKey = parseGitHubRepoKey(project.gitRepoUrl);
    if (!repoKey) return true;
    return keepIds.has(Number(project.id));
  });

  const removed = before - state.projects.length;
  if (!removed) return 0;

  const maxId = state.projects.reduce((highest, item) => Math.max(highest, Number(item.id) || 0), 0);
  state.nextProjectId = Math.max(maxId + 1, 1);
  saveState(state);
  return removed;
}

function createState() {
  return {
    nextProjectId: 1,
    nextInviteId: 1,
    invitations: [],
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

  if (!Array.isArray(state.invitations)) {
    state.invitations = [];
  }

  const maxInviteId = state.invitations.reduce((max, item) => {
    return Math.max(max, Number(item?.id) || 0);
  }, 0);

  if (!Number.isFinite(Number(state.nextInviteId)) || Number(state.nextInviteId) <= 0) {
    state.nextInviteId = maxInviteId + 1;
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

function invitationToResponse(invitation, state) {
  const project = (state?.projects || []).find((item) => Number(item.id) === Number(invitation.projectId));
  return {
    id: Number(invitation.id),
    projectId: Number(invitation.projectId),
    projectTitle: project ? String(project.title || "Untitled Project") : "Unknown Project",
    projectCourse: project ? String(project.course || "General Studies") : "General Studies",
    fromUsername: String(invitation.fromUsername || ""),
    toUsername: String(invitation.toUsername || ""),
    status: String(invitation.status || "pending"),
    createdAt: String(invitation.createdAt || ""),
    updatedAt: String(invitation.updatedAt || ""),
    respondedAt: String(invitation.respondedAt || "")
  };
}

function canAccessProject(project, username) {
  if (!project || !username) return false;
  const targetKey = usernameKey(username);
  if (!targetKey) return false;

  if (usernameKey(project.ownerUsername) === targetKey) return true;
  if (project.visibility === "shared") return true;

  return (Array.isArray(project.members) ? project.members : [])
    .some((member) => usernameKey(member) === targetKey);
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
const removedDuplicates = dedupeProjectsByRepoLink();
if (removedDuplicates > 0) {
  console.log(`Removed ${removedDuplicates} duplicate repo-linked project(s).`);
}

app.use(express.static(FRONTEND_DIR));
app.use("/api/github", githubRoutes);

app.post("/signup", authLimiter, async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const firstName = normalizeProfileField(req.body?.firstName, 80);
    const lastName = normalizeProfileField(req.body?.lastName, 80);
    const email = normalizeProfileField(req.body?.email, 160);
    const university = normalizeProfileField(req.body?.university, 120);
    const enrolledCourses = normalizeCourseList(req.body?.enrolledCourses || req.body?.course || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: "Username must be 3-32 chars and use letters, numbers, dot, dash, or underscore" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ error: "Password must be 8-128 characters" });
    }

    const users = readUsers();
    if (users.find((item) => usernameKey(item.username) === usernameKey(username))) {
      return res.status(400).json({ error: "User already exists" });
    }

    users.push({
      username,
      passwordHash: await hashPassword(password),
      firstName,
      lastName,
      email,
      university,
      course: enrolledCourses[0] || "",
      enrolledCourses,
      profilePhoto: "",
      createdAt: nowIso()
    });

    saveUsers(users);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to create user" });
  }
});

app.post("/login", authLimiter, async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || !password) return res.status(401).json({ error: "Invalid login" });

    const users = readUsers();
    const index = users.findIndex((item) => usernameKey(item.username) === usernameKey(username));
    if (index === -1) return res.status(401).json({ error: "Invalid login" });

    const user = users[index];
    const ok = await verifyPassword(user, password);
    if (!ok) return res.status(401).json({ error: "Invalid login" });

    // Transparently migrate legacy plaintext passwords to bcrypt hashes.
    if (!isBcryptHash(user.passwordHash) && user.password) {
      users[index] = {
        ...user,
        passwordHash: await hashPassword(password)
      };
      delete users[index].password;
      saveUsers(users);
    }

    return res.json({
      success: true,
      username: String(user.username || username),
      isAdmin: isAdminUsername(user.username || username),
      profile: userToPublicProfile(user)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
});

app.get("/users", (_req, res) => {
  const users = readUsers()
    .map((item) => String(item.username || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  res.json({ users });
});

app.get("/profile", (req, res) => {
  const username = normalizeUsername(req.query.username);
  if (!username) {
    return res.status(400).json({ error: "username query parameter is required" });
  }

  const users = readUsers();
  const user = findUserRecord(users, username);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({ profile: userToPublicProfile(user) });
});

app.put("/profile", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  if (!username) {
    return res.status(400).json({ error: "username is required" });
  }

  const users = readUsers();
  const index = users.findIndex((item) => usernameKey(item.username) === usernameKey(username));
  if (index === -1) {
    return res.status(404).json({ error: "User not found" });
  }

  const enrolledCourses = normalizeCourseList(req.body?.enrolledCourses || req.body?.course || "");

  users[index] = {
    ...users[index],
    firstName: normalizeProfileField(req.body?.firstName, 80),
    lastName: normalizeProfileField(req.body?.lastName, 80),
    email: normalizeProfileField(req.body?.email, 160),
    university: normalizeProfileField(req.body?.university, 120),
    enrolledCourses,
    course: enrolledCourses[0] || "",
    profilePhoto: normalizeProfilePhoto(req.body?.profilePhoto)
  };

  saveUsers(users);
  return res.json({ success: true, profile: userToPublicProfile(users[index]) });
});

app.post("/profile/password", authLimiter, async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || "");

    if (!username || !oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "username, oldPassword, newPassword, and confirmPassword are required" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match" });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: "New password must be 8-128 characters" });
    }

    const users = readUsers();
    const index = users.findIndex((item) => usernameKey(item.username) === usernameKey(username));
    if (index === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = users[index];
    const ok = await verifyPassword(user, oldPassword);
    if (!ok) {
      return res.status(401).json({ error: "Old password is incorrect" });
    }

    users[index] = {
      ...user,
      passwordHash: await hashPassword(newPassword)
    };
    delete users[index].password;

    saveUsers(users);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update password" });
  }
});

app.get("/circle/candidates", (req, res) => {
  const username = normalizeUsername(req.query.username);
  const projectId = Number(req.query.projectId);

  if (!username || !projectId) {
    return res.status(400).json({ error: "username and projectId are required" });
  }

  const state = loadState();
  const project = state.projects.find((item) => Number(item.id) === projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  if (usernameKey(project.ownerUsername) !== usernameKey(username)) {
    return res.status(403).json({ error: "Only the project owner can invite members" });
  }

  const users = readUsers();
  const ownerUser = findUserRecord(users, username);
  if (!ownerUser) {
    return res.status(404).json({ error: "Owner profile not found" });
  }

  const existingMemberKeys = new Set(
    (Array.isArray(project.members) ? project.members : []).map((member) => usernameKey(member))
  );

  const candidates = users
    .filter((item) => usernameKey(item.username) !== usernameKey(username))
    .filter((item) => !existingMemberKeys.has(usernameKey(item.username)))
    .filter((item) => isSameUniversity(ownerUser, item))
    .map((item) => userToPublicProfile(item));

  return res.json({
    project: {
      id: Number(project.id),
      title: String(project.title || "Untitled Project"),
      course: String(project.course || "General Studies")
    },
    ownerProfile: userToPublicProfile(ownerUser),
    candidates
  });
});

app.get("/invites", (req, res) => {
  const username = normalizeUsername(req.query.username);
  if (!username) {
    return res.status(400).json({ error: "username query parameter is required" });
  }

  const state = loadState();
  const key = usernameKey(username);
  const invitations = (state.invitations || []).map((item) => invitationToResponse(item, state));

  const incoming = invitations
    .filter((item) => usernameKey(item.toUsername) === key)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));

  const sent = invitations
    .filter((item) => usernameKey(item.fromUsername) === key)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));

  return res.json({ incoming, sent });
});

app.post("/projects/:id/invites", (req, res) => {
  const projectId = Number(req.params.id);
  const fromUsername = normalizeUsername(req.body?.username);
  const toUsername = normalizeUsername(req.body?.toUsername);

  if (!fromUsername || !toUsername) {
    return res.status(400).json({ error: "username and toUsername are required" });
  }

  if (usernameKey(fromUsername) === usernameKey(toUsername)) {
    return res.status(400).json({ error: "You cannot invite yourself" });
  }

  const state = loadState();
  const project = state.projects.find((item) => Number(item.id) === projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  if (usernameKey(project.ownerUsername) !== usernameKey(fromUsername)) {
    return res.status(403).json({ error: "Only the project owner can invite members" });
  }

  const users = readUsers();
  const sender = findUserRecord(users, fromUsername);
  const receiver = findUserRecord(users, toUsername);
  if (!sender || !receiver) {
    return res.status(404).json({ error: "User profile not found" });
  }

  if (!isSameUniversity(sender, receiver)) {
    return res.status(403).json({ error: "Invites are limited to users with the same university" });
  }

  const memberKeys = new Set((project.members || []).map((member) => usernameKey(member)));
  if (memberKeys.has(usernameKey(toUsername))) {
    return res.status(409).json({ error: "This user is already in the project" });
  }

  const existingPending = (state.invitations || []).find((item) => {
    return Number(item.projectId) === projectId &&
      usernameKey(item.toUsername) === usernameKey(toUsername) &&
      String(item.status || "pending") === "pending";
  });

  if (existingPending) {
    return res.status(409).json({ error: "A pending invite already exists for this user", invitation: invitationToResponse(existingPending, state) });
  }

  const timestamp = nowIso();
  const invitation = {
    id: state.nextInviteId++,
    projectId,
    fromUsername,
    toUsername,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    respondedAt: ""
  };

  state.invitations.push(invitation);
  saveState(state);

  return res.json({ success: true, invitation: invitationToResponse(invitation, state) });
});

app.post("/invites/:id/accept", (req, res) => {
  const inviteId = Number(req.params.id);
  const username = normalizeUsername(req.body?.username);

  if (!username) {
    return res.status(400).json({ error: "username is required" });
  }

  const state = loadState();
  const inviteIndex = (state.invitations || []).findIndex((item) => Number(item.id) === inviteId);
  if (inviteIndex === -1) {
    return res.status(404).json({ error: "Invite not found" });
  }

  const invite = state.invitations[inviteIndex];
  if (String(invite.status || "") !== "pending") {
    return res.status(409).json({ error: "Invite is not pending" });
  }

  if (usernameKey(invite.toUsername) !== usernameKey(username)) {
    return res.status(403).json({ error: "Only the invited user can accept this invite" });
  }

  const projectIndex = state.projects.findIndex((item) => Number(item.id) === Number(invite.projectId));
  if (projectIndex === -1) {
    return res.status(404).json({ error: "Project no longer exists" });
  }

  const project = state.projects[projectIndex];
  const nextMembers = normalizeMemberList([...(project.members || []), username], project.ownerUsername);
  const timestamp = nowIso();

  state.projects[projectIndex] = {
    ...project,
    members: nextMembers,
    team: formatTeamFromMembers(nextMembers),
    updatedAt: timestamp
  };

  state.invitations[inviteIndex] = {
    ...invite,
    status: "accepted",
    updatedAt: timestamp,
    respondedAt: timestamp
  };

  saveState(state);
  return res.json({
    success: true,
    invitation: invitationToResponse(state.invitations[inviteIndex], state),
    project: projectToResponse(state.projects[projectIndex])
  });
});

app.post("/invites/:id/decline", (req, res) => {
  const inviteId = Number(req.params.id);
  const username = normalizeUsername(req.body?.username);

  if (!username) {
    return res.status(400).json({ error: "username is required" });
  }

  const state = loadState();
  const inviteIndex = (state.invitations || []).findIndex((item) => Number(item.id) === inviteId);
  if (inviteIndex === -1) {
    return res.status(404).json({ error: "Invite not found" });
  }

  const invite = state.invitations[inviteIndex];
  if (String(invite.status || "") !== "pending") {
    return res.status(409).json({ error: "Invite is not pending" });
  }

  if (usernameKey(invite.toUsername) !== usernameKey(username)) {
    return res.status(403).json({ error: "Only the invited user can decline this invite" });
  }

  const timestamp = nowIso();
  state.invitations[inviteIndex] = {
    ...invite,
    status: "declined",
    updatedAt: timestamp,
    respondedAt: timestamp
  };

  saveState(state);
  return res.json({ success: true, invitation: invitationToResponse(state.invitations[inviteIndex], state) });
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

  const normalizedUsername = normalizeUsername(username);
  const normalizedTitle = String(title || "").trim();

  if (!normalizedUsername || !normalizedTitle) {
    return res.status(400).json({ error: "username and title are required" });
  }

  const state = loadState();
  const timestamp = nowIso();
  const repoKey = parseGitHubRepoKey(gitRepoUrl);

  if (repoKey) {
    const existing = findProjectByRepoKey(state, repoKey);
    if (existing) {
      return res.status(409).json({
        error: "This GitHub repository is already linked to another project.",
        existingProject: projectToResponse(existing)
      });
    }
  }

  const normalizedMembers = normalizeMemberList(members, normalizedUsername);
  const resolvedTeam = String(team || "").trim() || `Team: ${normalizedMembers.length} ${normalizedMembers.length === 1 ? "person" : "people"}`;

  const project = {
    id: state.nextProjectId++,
    title: normalizedTitle,
    ownerUsername: normalizedUsername,
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
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || usernameKey(existing.ownerUsername) !== usernameKey(normalizedUsername)) {
    return res.status(403).json({ error: "Only the owner can edit this project" });
  }

  const nextRepoUrl = gitRepoUrl !== undefined ? String(gitRepoUrl || "") : String(existing.gitRepoUrl || "");
  const repoKey = parseGitHubRepoKey(nextRepoUrl);
  if (repoKey) {
    const duplicate = findProjectByRepoKey(state, repoKey, existing.id);
    if (duplicate) {
      return res.status(409).json({
        error: "This GitHub repository is already linked to another project.",
        existingProject: projectToResponse(duplicate)
      });
    }
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
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || usernameKey(existing.ownerUsername) !== usernameKey(normalizedUsername)) {
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

app.use((err, _req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  if (err && String(err.message || "").includes("CORS")) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  return next(err);
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
