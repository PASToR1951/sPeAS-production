(function () {
  "use strict";

  function currentDocumentId() {
    var params = new URLSearchParams(window.location.search);
    return params.get("id") || new URLSearchParams(window.location.hash.replace(/^#/, "")).get("id");
  }

  function publicDownloadUrl(id) {
    var compiled = window.location.pathname.toLowerCase().includes("compiled");
    return compiled
      ? "/api/public/compiled-documents/" + encodeURIComponent(id) + "/foreword/download"
      : "/api/public/documents/" + encodeURIComponent(id) + "/download";
  }

  function upgradeLegacyActions() {
    var id = currentDocumentId();
    if (!id) return;
    var href = publicDownloadUrl(id);
    document.querySelectorAll("[data-document-access], [data-request-access], #requestAccessBtn, .request-access-button").forEach(function (element) {
      if (element instanceof HTMLAnchorElement) {
        element.href = href;
        element.textContent = "Download PDF";
        return;
      }
      var link = document.createElement("a");
      link.href = href;
      link.className = element.className;
      link.textContent = "Download PDF";
      element.replaceWith(link);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", upgradeLegacyActions);
  else upgradeLegacyActions();
})();
