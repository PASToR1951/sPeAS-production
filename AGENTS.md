# AGENTS.md

## Repository context

- Before implementing changes or doing broad codebase searches, check `docs/PeAS Capstone/` first for project context, requirements, architecture notes, terminology, and implementation details.
- Start with the most relevant files in that folder, such as `00 Home.md`, `01 Project Overview.md`, `11 System Architecture and Implementation.md`, and `12 Implementation Details.md`, then widen to the codebase only after that context has been reviewed.
- When using shell commands, quote the path because it contains a space: `docs/PeAS Capstone/`.

## UI design rules

- Do not use decorative edge accents anywhere in the product UI. This includes colored left, right, top, or bottom border strips, edge bars, category stripes, and pseudo-element accent lines on cards, banners, rows, panels, or navigation items.
- Use surfaces, typography, spacing, badges, icons, and semantic color treatments to establish hierarchy instead. A thin neutral border may be used only when it is structurally necessary to separate or contain content; it must not function as an accent.
- Before adding a new component-level border, verify that the same hierarchy cannot be expressed through the shared Dashboard/admin surface tokens.
