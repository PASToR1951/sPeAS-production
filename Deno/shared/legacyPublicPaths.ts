export interface LegacyPublicAsset {
  path: string;
  repositoryPath: string | null;
}

export interface LegacyPublicReleaseEvidence {
  releaseId: string;
  firstStartedAt: string;
  lastStartedAt: string;
  legacyHitCount: number;
  lastLegacyHitAt: string | null;
}

export interface LegacyPublicSoakEvaluation {
  ready: boolean;
  currentReleaseId: string;
  requiredCompletedReleases: number;
  completedReleases: LegacyPublicReleaseEvidence[];
  reasons: string[];
}

export const DEVELOPMENT_RELEASE_ID = "development";

export const LEGACY_PUBLIC_ASSETS: readonly LegacyPublicAsset[] = [
  {
    path: "/Components/header.html",
    repositoryPath: "Deno/Public/Components/header.html",
  },
  {
    path: "/Components/footer.html",
    repositoryPath: "Deno/Public/Components/footer.html",
  },
  {
    path: "/Components/NavBar/default-NavBar.html",
    repositoryPath: "Deno/Public/Components/NavBar/default-NavBar.html",
  },
  {
    path: "/Components/NavBar/user-Navbar.html",
    repositoryPath: "Deno/Public/Components/NavBar/user-Navbar.html",
  },
  {
    path: "/Components/NavBar/image.html",
    repositoryPath: "Deno/Public/Components/NavBar/image.html",
  },
  {
    path: "/Components/NavBar/dropdown-fix.js",
    repositoryPath: "Deno/Public/Components/NavBar/dropdown-fix.js",
  },
  {
    path: "/Components/js/navbar-loader.js",
    repositoryPath: "Deno/Public/Components/js/navbar-loader.js",
  },
  {
    path: "/Components/js/navbar-manager.js",
    repositoryPath: "Deno/Public/Components/js/navbar-manager.js",
  },
  {
    path: "/Components/js/navbar.js",
    repositoryPath: "Deno/Public/Components/js/navbar.js",
  },
  {
    path: "/Components/js/header-init.js",
    repositoryPath: "Deno/Public/Components/js/header-init.js",
  },
  {
    path: "/Components/js/document-access.js",
    repositoryPath: "Deno/Public/Components/js/document-access.js",
  },
  {
    path: "/Components/css/document-request.css",
    repositoryPath: "Deno/Public/Components/css/document-request.css",
  },
  { path: "/log-ien.html", repositoryPath: "Deno/Public/log-ien.html" },
  {
    path: "/Components/css/webflow-style.css",
    repositoryPath: "Deno/Public/Components/css/webflow-style.css",
  },
  {
    path: "/Components/js/webflow-script.js",
    repositoryPath: "Deno/Public/Components/js/webflow-script.js",
  },
  {
    path: "/Components/js/login.js",
    repositoryPath: "Deno/Public/Components/js/login.js",
  },
  {
    path: "/pages/miscellaneous/T&A-First.html",
    repositoryPath: "Deno/Public/pages/miscellaneous/T&A-First.html",
  },
  {
    path: "/Components/js/side_bar.js",
    repositoryPath: "Deno/Public/Components/js/side_bar.js",
  },
  {
    path: "/Components/js/userheader.js",
    repositoryPath: "Deno/Public/Components/js/userheader.js",
  },
  // Broken URLs emitted by legacy scripts are tracked as evidence even though
  // no repository file exists at these locations.
  { path: "/Components/user-navBar.html", repositoryPath: null },
  { path: "/css/document-request.css", repositoryPath: null },
] as const;

export const LEGACY_PUBLIC_REDIRECTS: Readonly<Record<string, string>> = {
  "/log-ien.html": "/log-in.html",
};

const legacyPathLookup = new Map(
  LEGACY_PUBLIC_ASSETS.map((
    asset,
  ) => [normalizePublicPath(asset.path), asset.path]),
);

export function matchLegacyPublicPath(pathname: string): string | null {
  return legacyPathLookup.get(normalizePublicPath(pathname)) ?? null;
}

export function normalizeReleaseId(value: string | undefined | null): string {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._:@/-]+/g, "-")
    .slice(0, 160);
  return normalized || DEVELOPMENT_RELEASE_ID;
}

export function evaluateLegacyPublicSoak(
  currentReleaseId: string,
  priorReleases: LegacyPublicReleaseEvidence[],
  requiredCompletedReleases = 2,
): LegacyPublicSoakEvaluation {
  const normalizedCurrentReleaseId = normalizeReleaseId(currentReleaseId);
  const required = Math.max(1, Math.trunc(requiredCompletedReleases));
  const completedReleases = priorReleases
    .filter((release) => release.releaseId !== normalizedCurrentReleaseId)
    .filter((release) => release.releaseId !== DEVELOPMENT_RELEASE_ID)
    .slice(0, required);
  const reasons: string[] = [];

  if (normalizedCurrentReleaseId === DEVELOPMENT_RELEASE_ID) {
    reasons.push(
      "PEAS_RELEASE_ID is not set to a production release identifier.",
    );
  }
  if (completedReleases.length < required) {
    reasons.push(
      `Only ${completedReleases.length} of ${required} required completed releases have been observed.`,
    );
  }
  for (const release of completedReleases) {
    if (release.legacyHitCount > 0) {
      reasons.push(
        `Release ${release.releaseId} recorded ${release.legacyHitCount} legacy-path request(s).`,
      );
    }
  }

  return {
    ready: reasons.length === 0,
    currentReleaseId: normalizedCurrentReleaseId,
    requiredCompletedReleases: required,
    completedReleases,
    reasons,
  };
}

function normalizePublicPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Match the original value when malformed URL encoding is received.
  }
  const normalized = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return (normalized.startsWith("/") ? normalized : `/${normalized}`)
    .toLowerCase();
}
