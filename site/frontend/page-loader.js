(function () {
  var LOADER_ID = "rolebitPageLoader";
  var MIN_VISIBLE_MS = 320;
  var MAX_VISIBLE_MS = 4200;
  var shownAt = Date.now();
  var hidden = false;

  function injectStyle() {
    if (document.getElementById("rolebitPageLoaderStyle")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "rolebitPageLoaderStyle";
    style.textContent = [
      ".rolebit-page-loader {",
      "  position: fixed;",
      "  inset: 0;",
      "  z-index: 2147483647;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  pointer-events: none;",
      "  background:",
      "    radial-gradient(circle at 50% 38%, rgba(40, 120, 84, 0.18), transparent 50%),",
      "    linear-gradient(180deg, rgba(6, 10, 8, 0.96), rgba(4, 7, 6, 0.98));",
      "  backdrop-filter: blur(5px);",
      "  transition: opacity 0.35s ease, visibility 0.35s ease;",
      "  animation: rolebitLoaderFailsafeHide 0s linear 3.8s forwards;",
      "}",
      ".rolebit-page-loader.hide {",
      "  opacity: 0;",
      "  visibility: hidden;",
      "  pointer-events: none;",
      "}",
      ".rolebit-page-loader .loader-mark {",
      "  display: grid;",
      "  place-items: center;",
      "}",
      ".rolebit-page-loader .loader-mark img {",
      "  width: 76px;",
      "  height: 76px;",
      "  object-fit: contain;",
      "  filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.45));",
      "  animation: rolebitLoaderPulse 1.35s ease-in-out infinite;",
      "}",
      "@keyframes rolebitLoaderPulse {",
      "  0% { transform: scale(0.96); opacity: 0.82; }",
      "  60% { transform: scale(1.03); opacity: 1; }",
      "  100% { transform: scale(0.96); opacity: 0.82; }",
      "}",
      "@keyframes rolebitLoaderFailsafeHide {",
      "  to { opacity: 0; visibility: hidden; pointer-events: none; }",
      "}",
      "",
      "/* Global visual override: black glass + smoother motion */",
      ":root {",
      "  --rb-glass-bg: rgba(7, 10, 9, 0.82);",
      "  --rb-glass-bg-strong: rgba(5, 7, 7, 0.9);",
      "  --rb-glass-line: rgba(112, 152, 132, 0.28);",
      "  --rb-text-muted: rgba(204, 224, 214, 0.82);",
      "  --rb-ease-smooth: cubic-bezier(0.22, 1, 0.36, 1);",
      "}",
      "html, body {",
      "  background:",
      "    radial-gradient(circle at 12% 20%, rgba(13, 34, 24, 0.62), transparent 42%),",
      "    radial-gradient(circle at 78% 80%, rgba(9, 28, 20, 0.55), transparent 44%),",
      "    linear-gradient(180deg, #040706, #020504) !important;",
      "  color: #edf5ef !important;",
      "}",
      ".sidebar {",
      "  background: linear-gradient(180deg, rgba(6, 9, 9, 0.94), rgba(4, 6, 6, 0.94)) !important;",
      "  border: 1px solid var(--rb-glass-line) !important;",
      "  backdrop-filter: blur(14px) saturate(110%) !important;",
      "  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.42) !important;",
      "  transition: width 0.42s var(--rb-ease-smooth), box-shadow 0.32s var(--rb-ease-smooth) !important;",
      "}",
      ".sidebar a {",
      "  color: rgba(225, 237, 230, 0.9) !important;",
      "  transition: background-color 0.28s var(--rb-ease-smooth), border-color 0.28s var(--rb-ease-smooth), color 0.28s var(--rb-ease-smooth), transform 0.28s var(--rb-ease-smooth) !important;",
      "}",
      ".sidebar a:hover, .sidebar a.active {",
      "  background: rgba(34, 48, 42, 0.52) !important;",
      "  border-color: rgba(130, 176, 152, 0.42) !important;",
      "  color: #f2f8f4 !important;",
      "}",
      ".panel,",
      ".project-card,",
      ".repo-card,",
      ".detail-item,",
      ".quick-task-card,",
      ".widget,",
      ".github-integration-shell,",
      ".github-dashboard-shell,",
      ".github-insights-panel,",
      ".github-commit-panel {",
      "  background: var(--rb-glass-bg) !important;",
      "  border-color: var(--rb-glass-line) !important;",
      "  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.34) !important;",
      "  backdrop-filter: blur(14px) saturate(108%) !important;",
      "}",
      ".pill-btn, .small-action-btn, button {",
      "  background: linear-gradient(180deg, rgba(28, 40, 36, 0.76), rgba(20, 30, 27, 0.76)) !important;",
      "  border-color: rgba(126, 170, 148, 0.52) !important;",
      "  color: #e8f2eb !important;",
      "  transition: background-color 0.28s var(--rb-ease-smooth), border-color 0.28s var(--rb-ease-smooth), transform 0.32s var(--rb-ease-smooth), box-shadow 0.32s var(--rb-ease-smooth) !important;",
      "}",
      ".pill-btn.primary, button.primary {",
      "  background: linear-gradient(180deg, rgba(42, 58, 52, 0.84), rgba(30, 44, 39, 0.84)) !important;",
      "  border-color: rgba(146, 190, 168, 0.58) !important;",
      "}",
      ".pill-btn:hover, .small-action-btn:hover, button:hover {",
      "  transform: translateY(-1px) !important;",
      "  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.36) !important;",
      "}",
      "input, select, textarea, .edit-input, .edit-select, .edit-textarea {",
      "  background: var(--rb-glass-bg-strong) !important;",
      "  border-color: rgba(122, 162, 142, 0.44) !important;",
      "  color: #eef6f0 !important;",
      "}",
      ".project-meta, .detail-mini, .projects-subtitle, .github-status, .github-empty, .repo-meta, .linked {",
      "  color: var(--rb-text-muted) !important;",
      "}",
      ".projects-page, .page-wrap, .dashboard-container {",
      "  transition: margin-left 0.46s var(--rb-ease-smooth) !important;",
      "}",
      ".project-card, .widget, .repo-card, .detail-item {",
      "  transition: border-color 0.32s var(--rb-ease-smooth), box-shadow 0.32s var(--rb-ease-smooth), transform 0.32s var(--rb-ease-smooth), background-color 0.32s var(--rb-ease-smooth) !important;",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  *, *::before, *::after {",
      "    animation-duration: 0.001ms !important;",
      "    animation-iteration-count: 1 !important;",
      "    transition-duration: 0.001ms !important;",
      "  }",
      "}",
    ].join("\n");

    document.head.appendChild(style);
  }

  function createLoader() {
    if (document.getElementById(LOADER_ID) || !document.body) {
      return;
    }

    var overlay = document.createElement("div");
    overlay.id = LOADER_ID;
    overlay.className = "rolebit-page-loader";
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-label", "Loading page");
    overlay.innerHTML = '<div class="loader-mark"><img src="logo.png" alt="Rolebit Logo"></div>';

    document.body.appendChild(overlay);
  }

  function mountWhenReady() {
    if (document.body) {
      injectStyle();
      createLoader();
      return;
    }

    requestAnimationFrame(mountWhenReady);
  }

  function hideLoader() {
    if (hidden) {
      return;
    }

    var overlay = document.getElementById(LOADER_ID);
    if (!overlay) {
      hidden = true;
      return;
    }

    hidden = true;
    var elapsed = Date.now() - shownAt;
    var wait = Math.max(MIN_VISIBLE_MS - elapsed, 0);

    setTimeout(function () {
      overlay.classList.add("hide");
      setTimeout(function () {
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 380);
    }, wait);
  }

  mountWhenReady();

  document.addEventListener("DOMContentLoaded", hideLoader, { once: true });

  if (document.readyState === "complete") {
    hideLoader();
  } else {
    window.addEventListener("load", hideLoader, { once: true });
  }

  setTimeout(hideLoader, 2500);

  // Absolute fallback: never leave loader mounted indefinitely.
  setTimeout(function () {
    var overlay = document.getElementById(LOADER_ID);
    if (!overlay) return;
    overlay.classList.add("hide");
    setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 380);
  }, MAX_VISIBLE_MS);
})();
