const crypto = require("crypto");

function verifyGithubWebhook(req, res, next) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "GITHUB_WEBHOOK_SECRET is not configured" });
  }

  const signature = String(req.headers["x-hub-signature-256"] || "");
  if (!signature.startsWith("sha256=")) {
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  const rawBody = req.rawBody || "";
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expected = `sha256=${digest}`;

  const isValid =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!isValid) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  next();
}

module.exports = verifyGithubWebhook;
