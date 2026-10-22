import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PublicVolumeContents,
  VolumeMembershipReview,
} from "../../../../shared/imports";
import { apiFetch, getErrorMessage } from "../../lib/api/http";
import { SimplePdfReader } from "./SimplePdfReader";
import "../../styles/document-preparation.css";

export function VolumeContentsReader(
  { id, administrator = false }: { id: string; administrator?: boolean },
) {
  const [contents, setContents] = useState<PublicVolumeContents | null>(null);
  const [paperId, setPaperId] = useState(() =>
    new URLSearchParams(location.search).get("paper")
  );
  const [page, setPage] = useState(() =>
    Math.max(1, Number(new URLSearchParams(location.search).get("page")) || 1)
  );
  const [search, setSearch] = useState(""),
    [open, setOpen] = useState(true),
    [error, setError] = useState(""),
    [pdfError, setPdfError] = useState(""),
    [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [membership, setMembership] = useState<VolumeMembershipReview | null>(
    null,
  );
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const base = administrator
    ? "/api/compiled-documents"
    : "/api/public/compiled-documents";
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PublicVolumeContents>(`${base}/${id}/contents`, {
      signal: controller.signal,
    }).then((data) => {
      setContents(data);
      setMembership(null);
      setError("");
    }).catch((e) => {
      if (!controller.signal.aborted) {
        setError(getErrorMessage(e));
        if (administrator) {
          void apiFetch<VolumeMembershipReview>(
            `${base}/${id}/contents-resolution`,
            { signal: controller.signal },
          ).then((review) => {
            setContents(null);
            setMembership(review);
            setConfirmed(false);
            setAssignments(
              Object.fromEntries(
                review.papers.map((
                  p,
                ) => [
                  p.id,
                  p.primaryParent === null ? "" : String(p.primaryParent),
                ]),
              ),
            );
          }).catch(() => undefined);
        }
      }
    });
    return () => controller.abort();
  }, [administrator, base, id, refresh]);
  const selected = contents?.papers.find((p) => String(p.id) === paperId) ??
    contents?.papers[0];
  const writeLocation = useCallback(
    (paper: number, nextPage: number, version: string, replace = false) => {
      const url = new URL(location.href);
      url.searchParams.set("paper", String(paper));
      url.searchParams.set("page", String(nextPage));
      url.searchParams.set("version", version);
      if (url.href !== location.href) {
        history[replace ? "replaceState" : "pushState"]({}, "", url);
      }
      setPaperId(String(paper));
      setPage(nextPage);
    },
    [],
  );
  useEffect(() => {
    if (!selected) return;
    const params = new URLSearchParams(location.search);
    const version = params.get("version");
    const missing = paperId && String(selected.id) !== paperId;
    if (missing) {
      setNotice(
        "The requested paper is no longer available. Showing the first available paper.",
      );
      writeLocation(selected.id, 1, selected.version, true);
    } else if (version && version !== selected.version) {
      setNotice("This paper has a newer PDF. Reading has restarted at page 1.");
      writeLocation(selected.id, 1, selected.version, true);
    } else {writeLocation(
        selected.id,
        Math.min(Math.max(1, page), selected.pages || Number.MAX_SAFE_INTEGER),
        selected.version,
        true,
      );}
  }, [selected, paperId, page, writeLocation]);
  useEffect(() => {
    const restore = () => {
      const p = new URLSearchParams(location.search);
      setPaperId(p.get("paper"));
      setPage(Math.max(1, Number(p.get("page")) || 1));
      setPdfError("");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const filtered = useMemo(
    () =>
      contents?.papers.filter((p) =>
        `${p.title} ${p.authors.map((a) => a.full_name).join(" ")}`
          .toLocaleLowerCase().includes(search.toLocaleLowerCase())
      ) ?? [],
    [contents, search],
  );
  const index = contents?.papers.findIndex((p) => p.id === selected?.id) ?? -1;
  const select = (paper: NonNullable<typeof selected>) => {
    setPdfError("");
    setNotice("");
    writeLocation(paper.id, 1, paper.version);
    if (matchMedia("(max-width: 736px)").matches) setOpen(false);
  };
  const reorder = async (direction: number) => {
    if (!contents || index < 0) return;
    const papers = [...contents.papers];
    [papers[index], papers[index + direction]] = [
      papers[index + direction],
      papers[index],
    ];
    try {
      const updated = await apiFetch<PublicVolumeContents>(
        `${base}/${id}/contents`,
        {
          method: "PUT",
          json: {
            revision: contents.revision,
            paperIds: papers.map((p) => p.id),
          },
        },
      );
      setContents(updated);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };
  const resolveMembership = async () => {
    if (!membership || !confirmed) return;
    try {
      await apiFetch(`${base}/${id}/contents-resolution`, {
        method: "PUT",
        json: {
          confirm: true,
          collections: membership.collections,
          assignments: membership.papers.map((p) => ({
            paperId: p.id,
            parentId: assignments[p.id] === "none"
              ? null
              : Number(assignments[p.id]),
          })),
        },
      });
      setMembership(null);
      setError("");
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };
  return (
    <section
      className="peas-volume-reader"
      aria-label="Read papers in this collection"
    >
      <header>
        <h2>Read this collection</h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`volume-contents-${id}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Show"} contents
        </button>
      </header>
      {error
        ? (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={() => setRefresh((v) => v + 1)}>
              Reload contents
            </button>
          </p>
        )
        : null}
      {membership
        ? (
          <div className="peas-preparation-surface">
            <h3>Resolve collection membership</h3>
            <p>
              These legacy records disagree about which collection owns a paper.
              Choose one primary collection for every paper. Saving removes its
              other links and records your decision. Review the reading order
              afterward.
            </p>
            <div className="peas-preparation-grid">
              {membership.papers.map((paper) => (
                <label className="peas-preparation-field" key={paper.id}>
                  <span>Primary collection for {paper.title}</span>
                  <select
                    value={assignments[paper.id] ?? ""}
                    onChange={(e) => {
                      setAssignments({
                        ...assignments,
                        [paper.id]: e.target.value,
                      });
                      setConfirmed(false);
                    }}
                  >
                    <option value="" disabled>Choose a collection</option>
                    <option value="none">No collection</option>
                    {membership.collections.filter((c) =>
                      c.id === Number(id) || c.id === paper.primaryParent ||
                      paper.linkedParents.includes(c.id)
                    ).map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="peas-preparation-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />I reviewed the primary collection for every listed paper.
            </label>
            <button
              type="button"
              disabled={!confirmed ||
                membership.papers.some((p) => !assignments[p.id])}
              onClick={() => void resolveMembership()}
            >
              Save reviewed memberships
            </button>
          </div>
        )
        : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!contents && !error
        ? <p role="status">Loading collection contents…</p>
        : null}
      {contents && !contents.papers.length
        ? <p>No published papers are available in this collection.</p>
        : null}
      <div
        className={`peas-volume-reader__layout${open ? "" : " is-collapsed"}`}
      >
        {open
          ? (
            <nav
              id={`volume-contents-${id}`}
              aria-label="Papers in reading order"
            >
              <label>
                Find a paper<input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title or author"
                />
              </label>
              <p role="status">{filtered.length} papers</p>
              <ol>
                {filtered.map((paper) => (
                  <li key={paper.id}>
                    <button
                      type="button"
                      aria-current={paper.id === selected?.id
                        ? "true"
                        : undefined}
                      onClick={() => select(paper)}
                    >
                      <span>{paper.position}. {paper.title}</span>
                      <small>
                        {paper.authors.map((a) => a.full_name).join(", ")}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
              {!filtered.length
                ? <p>No matching papers. Your current paper remains open.</p>
                : null}
            </nav>
          )
          : null}
        {selected
          ? (
            <article>
              <header>
                <h3>{selected.title}</h3>
                <p>{selected.authors.map((a) => a.full_name).join(", ")}</p>
                <p>
                  {selected.documentType} · {selected.publicationDate?.slice(
                    0,
                    selected.datePrecision === "year"
                      ? 4
                      : selected.datePrecision === "month"
                      ? 7
                      : 10,
                  ) || "Date unavailable"} · {selected.pages ?? "Unknown"} pages
                </p>
              </header>
              <div
                className="peas-preparation-actions"
                aria-label="Paper navigation"
              >
                <button
                  type="button"
                  disabled={index <= 0}
                  onClick={() => select(contents!.papers[index - 1])}
                >
                  Previous paper
                </button>
                <span>Paper {index + 1} of {contents?.papers.length}</span>
                <button
                  type="button"
                  disabled={index < 0 ||
                    index >= (contents?.papers.length ?? 0) - 1}
                  onClick={() => select(contents!.papers[index + 1])}
                >
                  Next paper
                </button>
              </div>
              {administrator
                ? (
                  <div className="peas-preparation-actions">
                    <button
                      type="button"
                      disabled={index <= 0}
                      onClick={() => void reorder(-1)}
                    >
                      Move paper earlier
                    </button>
                    <button
                      type="button"
                      disabled={index >= (contents?.papers.length ?? 0) - 1}
                      onClick={() => void reorder(1)}
                    >
                      Move paper later
                    </button>
                  </div>
                )
                : null}
              {selected.hasPdf && !pdfError
                ? (
                  <SimplePdfReader
                    key={`${selected.id}-${selected.version}-${refresh}`}
                    url={`${base}/${id}/papers/${selected.id}/inline?v=${
                      encodeURIComponent(selected.version)
                    }`}
                    title={selected.title}
                    page={page}
                    onPageChange={(n) =>
                      writeLocation(selected.id, n, selected.version)}
                    onLoaded={() => setPdfError("")}
                    onError={() => setPdfError("This PDF could not be loaded.")}
                  />
                )
                : (
                  <p role={pdfError ? "alert" : undefined}>
                    {pdfError ||
                      "The PDF is currently unavailable. The paper metadata remains available."}
                    {" "}
                    {pdfError
                      ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPdfError("");
                            setRefresh((v) => v + 1);
                          }}
                        >
                          Retry PDF
                        </button>
                      )
                      : null}
                  </p>
                )}
              {selected.abstract
                ? (
                  <details>
                    <summary>Abstract</summary>
                    <p>{selected.abstract}</p>
                  </details>
                )
                : null}
              <div className="peas-preparation-actions">
                <a href={`/pages/guest-single.html?id=${selected.id}`}>
                  Paper details
                </a>
                {selected.hasPdf
                  ? (
                    <a
                      href={`/api/${
                        administrator ? "" : "public/"
                      }documents/${selected.id}/download`}
                    >
                      Download paper PDF
                    </a>
                  )
                  : null}
              </div>
            </article>
          )
          : null}
      </div>
    </section>
  );
}
