import { sendCanvasMessage } from "./ExperienceCanvasText";
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  EXPERIENCE_DEFAULT_ORGANIZATION_PHOTO_POSITION,
  EXPERIENCE_DEFAULT_ORGANIZATION_ROLES,
  ExperienceOrganizationPhotoPositionSchema,
  type ExperienceOrganizationRole,
} from "../../../../Deno/shared/experienceConfig";

export type OrgChartRoleContent = {
  id: string;
  title?: string;
  label?: string;
  caption?: string;
  name?: string;
  photo?: string;
  photoAlt?: string;
  photoPosition?: ExperienceOrganizationRole["photoPosition"];
};

type OrgRole = ExperienceOrganizationRole & {
  fill: string;
  ring: string;
};

const ROLE_COLORS: Record<OrgRole["id"], Pick<OrgRole, "fill" | "ring">> = {
  president: { fill: "#f5c95d", ring: "#d5e8dc" },
  "vp-student-affairs": { fill: "#8cc7b3", ring: "#d7e9e0" },
  "director-orp": { fill: "#8fc6d6", ring: "#d7e8ec" },
  "research-assistant": { fill: "#d9b8d3", ring: "#eadcea" },
  "administrative-assistant": { fill: "#d9b8d3", ring: "#eadcea" },
  "editorial-in-chief": { fill: "#f0c36e", ring: "#f2e2c3" },
  "technical-board": { fill: "#f5c95d", ring: "#f2e2c3" },
  "research-ethics-committee": { fill: "#84c7b0", ring: "#d7e9e0" },
};

const DEFAULT_ROLES = EXPERIENCE_DEFAULT_ORGANIZATION_ROLES.map((role) => ({
  ...role,
  ...ROLE_COLORS[role.id],
}));

export function OrgChart({ roles, canvasMode = false }: { roles?: readonly OrgChartRoleContent[]; canvasMode?: boolean }) {
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
                <OrgNode role={role} canvasMode={canvasMode} />
              </li>
            </Fragment>
          ))}

          <li className="peas-org-link" aria-hidden="true" />
          <li>
            <ol className="peas-org-units" aria-label="Office roles, boards, and committees">
              {units.map((role) => (
                <li className="peas-org-unit" key={role.id}>
                  <OrgNode role={role} canvasMode={canvasMode} />
                </li>
              ))}
            </ol>
          </li>
        </ol>
      </div>
    </div>
  );
}

function OrgNode({ role, canvasMode }: { role: OrgRole; canvasMode: boolean }) {
  const name = role.name === role.title ? "" : role.name;
  const title = role.title.toLowerCase().replaceAll(" & ", " and ");
  const caption = role.caption.toLowerCase().replaceAll(" & ", " and ");

  return (
    <article className={`peas-org-node${role.group ? " is-group" : ""}`}>
      <OrgFigure role={role} />
      <div className="peas-org-node__meta">
        <strong className={name ? "peas-org-node__name" : "peas-org-node__title"}>{name || role.title}</strong>
        {name ? <span className="peas-org-node__title">{role.title}</span> : null}
        {title !== caption && !title.endsWith(` ${caption}`) ? <span className="peas-org-caption">{role.caption}</span> : null}
        {canvasMode && (
          <button
            className="peas-canvas-photo-button"
            type="button"
            aria-label={`Edit role and photo for ${role.title}`}
            onClick={() => sendCanvasMessage({ type: "experience-canvas-role", roleId: role.id })}
          >
            Edit role and photo
          </button>
        )}
      </div>
    </article>
  );
}

function OrgFigure({ role }: { role: OrgRole }) {
  const [broken, setBroken] = useState(false);
  const { x, y } = role.photoPosition ?? EXPERIENCE_DEFAULT_ORGANIZATION_PHOTO_POSITION;

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
          style={{ objectPosition: `${x}% ${y}%` }}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <Silhouette group={role.group && !role.name} />
      )}
    </span>
  );
}

function mergeRoleContent(roles?: readonly OrgChartRoleContent[]) {
  const incoming = new Map((roles ?? []).map((role) => [role.id, role]));
  const roster = DEFAULT_ROLES.map((role): OrgRole => {
    const content = incoming.get(role.id);
    if (!content) return role;

    return {
      ...role,
      title: editableText(content.title, editableText(content.label, role.title)),
      label: editableText(content.label, role.label),
      caption: editableText(content.caption, role.caption),
      name: optionalText(content.name, role.name),
      photo: optionalText(content.photo, role.photo),
      photoAlt: optionalText(content.photoAlt, role.photoAlt),
      photoPosition: ExperienceOrganizationPhotoPositionSchema.safeParse(content.photoPosition).data,
    };
  });

  return { chain: roster.slice(0, 3), units: roster.slice(3) };
}

function editableText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
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
