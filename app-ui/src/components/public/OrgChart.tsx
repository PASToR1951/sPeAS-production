import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";

export type OrgChartRoleContent = {
  id: string;
  title?: string;
  label?: string;
  caption?: string;
  name?: string;
  photo?: string;
  photoAlt?: string;
};

type OrgRole = {
  id: string;
  /** Full role title, shown when it adds information beyond the short label. */
  title: string;
  /** Compact role label used as the primary heading when no person is set. */
  label: string;
  /** Office or unit shown as a small metadata badge. */
  caption: string;
  /** Person currently holding the role. */
  name?: string;
  /** Portrait shown inside the circular avatar frame. */
  photo?: string;
  /** Alternative text supplied by an administrator for an uploaded portrait. */
  photoAlt?: string;
  /** Boards and committees render a group silhouette. */
  group?: boolean;
  /** Card fill and avatar ring colors. */
  fill: string;
  ring: string;
};

const DEFAULT_CHAIN: OrgRole[] = [
  {
    id: "president",
    title: "University President",
    label: "University President",
    caption: "Administration",
    fill: "#f5c95d",
    ring: "#d5e8dc",
  },
  {
    id: "vp-student-affairs",
    title: "Vice President, Student Affairs",
    label: "Vice President",
    caption: "Student Affairs",
    fill: "#8cc7b3",
    ring: "#d7e9e0",
  },
  {
    id: "director-orp",
    title: "Director, Office of Research and Publications",
    label: "Director",
    caption: "Research & Publications",
    fill: "#8fc6d6",
    ring: "#d7e8ec",
  },
];

const DEFAULT_UNITS: OrgRole[] = [
  {
    id: "associate-assistant",
    title: "Associate Assistant",
    label: "Associate Assistant",
    caption: "Office Support",
    fill: "#d9b8d3",
    ring: "#eadcea",
  },
  {
    id: "editorial-board",
    title: "Editorial Board",
    label: "Editorial Board",
    caption: "Publications",
    fill: "#f0c36e",
    ring: "#f2e2c3",
    group: true,
  },
  {
    id: "technical-board",
    title: "Technical Board",
    label: "Technical Board",
    caption: "Research Review",
    fill: "#f5c95d",
    ring: "#f2e2c3",
    group: true,
  },
  {
    id: "research-ethics-board",
    title: "Research Ethics Board",
    label: "Research Ethics Board",
    caption: "Ethics Review",
    fill: "#84c7b0",
    ring: "#d7e9e0",
    group: true,
  },
];

export function OrgChart({ roles }: { roles?: readonly OrgChartRoleContent[] }) {
  const { chain, units } = useMemo(() => mergeRoleContent(roles), [roles]);

  return (
    <div className="peas-org-chart">
      <div className="peas-org-content">
        <ol
          className="peas-org-tree"
          aria-label="Organizational chart for the Office of Research and Publications"
        >
          {chain.map((role, index) => (
            <Fragment key={role.id}>
              {index > 0 ? <li className="peas-org-link peas-org-link--into" aria-hidden="true" /> : null}
              <li className="peas-org-row">
                <OrgNode role={role} />
              </li>
            </Fragment>
          ))}

          <li className="peas-org-link" aria-hidden="true" />
          <li>
            <ol className="peas-org-units" aria-label="Office units and boards">
              {units.map((role) => (
                <li className="peas-org-unit" key={role.id}>
                  <OrgNode role={role} />
                </li>
              ))}
            </ol>
          </li>
        </ol>
      </div>
    </div>
  );
}

function OrgNode({ role }: { role: OrgRole }) {
  const secondaryTitle = role.title.trim() && role.title.trim() !== role.label.trim()
    ? role.title
    : "";

  return (
    <article className={`peas-org-node${role.group ? " is-group" : ""}`}>
      <OrgFigure role={role} />
      <div className="peas-org-node__meta">
        <strong className="peas-org-node__name">{role.name || role.label}</strong>
        {secondaryTitle ? <span className="peas-org-node__title">{secondaryTitle}</span> : null}
        <span className="peas-org-caption">{role.caption}</span>
      </div>
    </article>
  );
}

function OrgFigure({ role }: { role: OrgRole }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [role.photo]);

  return (
    <span
      className="peas-org-figure"
      style={{ "--org-fill": role.fill, "--org-ring": role.ring } as CSSProperties}
    >
      <span className="peas-org-avatar-ring" aria-hidden="true" />
      {role.photo && !broken ? (
        <img
          className="peas-org-person"
          src={role.photo}
          alt={role.photoAlt || (role.name ? `Portrait of ${role.name}` : "")}
          onError={() => setBroken(true)}
        />
      ) : (
        <Silhouette group={role.group} />
      )}
    </span>
  );
}

function mergeRoleContent(roles?: readonly OrgChartRoleContent[]) {
  const incoming = new Map((roles ?? []).map((role) => [role.id, role]));
  const merge = (role: OrgRole): OrgRole => {
    const content = incoming.get(role.id);
    if (!content) return role;

    return {
      ...role,
      title: editableText(content.title, role.title),
      label: editableText(content.label, role.label),
      caption: editableText(content.caption, role.caption),
      name: optionalText(content.name),
      photo: optionalText(content.photo),
      photoAlt: optionalText(content.photoAlt),
    };
  };

  const chain = DEFAULT_CHAIN.map(merge);
  const units = DEFAULT_UNITS.map(merge);
  return { chain, units };
}

function editableText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function Silhouette({ group }: { group?: boolean }) {
  if (group) {
    return (
      <svg className="peas-org-person" viewBox="0 0 120 100" aria-hidden="true">
        <g fill="#365448">
          <circle cx="38" cy="33" r="13" />
          <path d="M14 100 C14 76 25 64 38 64 C51 64 62 76 62 100 Z" />
        </g>
        <g fill="#476b5c">
          <circle cx="82" cy="33" r="13" />
          <path d="M58 100 C58 76 69 64 82 64 C95 64 106 76 106 100 Z" />
        </g>
        <g fill="#234638">
          <circle cx="60" cy="34" r="16" />
          <path d="M30 100 C30 78 43 66 60 66 C77 66 90 78 90 100 Z" />
        </g>
      </svg>
    );
  }

  return (
    <svg className="peas-org-person" viewBox="0 0 100 100" aria-hidden="true">
      <g fill="#234638">
        <circle cx="50" cy="28" r="18" />
        <path d="M14 100 C14 72 30 58 50 58 C70 58 90 72 90 100 Z" />
      </g>
    </svg>
  );
}
