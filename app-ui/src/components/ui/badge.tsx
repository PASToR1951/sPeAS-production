import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "default" | "green" | "gold" | "rose" | "violet" | "blue" | "slate";
}

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
  return <span className={cn("peas-ui-badge", `peas-ui-badge--${tone}`, className)} {...props} />;
}
