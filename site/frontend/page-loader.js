(function () {
  var LOADER_ID = "rolebitPageLoader";
  var MIN_VISIBLE_MS = 320;
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
})();
