const express = require("express");
const githubController = require("../controllers/githubController");
const verifyGithubWebhook = require("../middleware/verifyGithubWebhook");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/install/url", requireAuth, githubController.getInstallUrl);
router.get("/callback", githubController.handleCallback);
router.post("/webhook", verifyGithubWebhook, githubController.webhook);
router.get("/repos", requireAuth, githubController.listRepos);
router.get("/repos/:repoId/commits", requireAuth, githubController.listRepoCommits);
router.post("/sync/:repoId", requireAuth, githubController.syncRepo);
router.delete("/repos/:repoId", requireAuth, githubController.disconnectRepo);

module.exports = router;
