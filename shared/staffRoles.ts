export const STAFF_ROLES = [
  "repository_assistant",
  "manuscript_reviewer",
  "news_editor",
] as const;
export type StaffRole = typeof STAFF_ROLES[number];
export type WorkspaceRole = "admin" | StaffRole;

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: "Administrator",
  repository_assistant: "Repository Assistant",
  manuscript_reviewer: "Manuscript Reviewer",
  news_editor: "News Editor",
};

export const STAFF_WORKSPACE = "/admin/Components/staff-workspace.html";

export function isStaffRole(role: unknown): role is StaffRole {
  return STAFF_ROLES.some((value) => role === value);
}
