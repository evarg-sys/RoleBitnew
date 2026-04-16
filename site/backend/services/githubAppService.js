const { App } = require("octokit");

let appInstance = null;

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getPrivateKey() {
  const raw = getRequiredEnv("GITHUB_PRIVATE_KEY");
  return raw.replace(/\\n/g, "\n");
}

function getApp() {
  if (appInstance) return appInstance;

  appInstance = new App({
    appId: getRequiredEnv("GITHUB_APP_ID"),
    privateKey: getPrivateKey(),
    webhooks: {
      secret: getRequiredEnv("GITHUB_WEBHOOK_SECRET")
    }
  });

  return appInstance;
}

function buildInstallUrl(stateValue = "") {
  const appSlug = process.env.GITHUB_APP_NAME;
  if (!appSlug) {
    throw new Error("GITHUB_APP_NAME is required to build install URL");
  }

  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  if (stateValue) {
    url.searchParams.set("state", stateValue);
  }
  return url.toString();
}

async function getInstallationOctokit(installationId) {
  const app = getApp();
  return app.getInstallationOctokit(Number(installationId));
}

async function getInstallationDetails(installationId) {
  const app = getApp();
  const response = await app.octokit.request("GET /app/installations/{installation_id}", {
    installation_id: Number(installationId)
  });
  return response.data;
}

async function listInstallationRepositories(installationId) {
  const octokit = await getInstallationOctokit(installationId);
  const repositories = [];
  let page = 1;

  while (page <= 10) {
    const response = await octokit.request("GET /installation/repositories", {
      per_page: 100,
      page
    });

    const incoming = Array.isArray(response.data.repositories) ? response.data.repositories : [];
    repositories.push(...incoming);
    if (incoming.length < 100) break;
    page += 1;
  }

  return repositories;
}

async function listRepositoryCommits(installationId, owner, repo, branch) {
  const octokit = await getInstallationOctokit(installationId);
  const commits = [];
  let page = 1;

  while (page <= 5) {
    const response = await octokit.request("GET /repos/{owner}/{repo}/commits", {
      owner,
      repo,
      sha: branch || undefined,
      per_page: 50,
      page
    });

    const incoming = Array.isArray(response.data) ? response.data : [];
    commits.push(...incoming);
    if (incoming.length < 50) break;
    page += 1;
  }

  return commits;
}

async function getCommitDetails(installationId, owner, repo, sha) {
  const octokit = await getInstallationOctokit(installationId);
  const response = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", {
    owner,
    repo,
    ref: sha
  });

  return response.data;
}

module.exports = {
  buildInstallUrl,
  getInstallationDetails,
  getInstallationOctokit,
  listInstallationRepositories,
  listRepositoryCommits,
  getCommitDetails
};
