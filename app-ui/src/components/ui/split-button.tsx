import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface SplitButtonProps {
  buttonProps?: ButtonProps;
  menuButtonLabel: string;
  menuItems?: ReactNode;
  menuContentClassName?: string;
  children: ReactNode;
}

/** A primary action with a keyboard-accessible menu attached to its right edge. */
export function SplitButton({
  buttonProps,
  menuButtonLabel,
  menuItems,
  menuContentClassName,
  children,
}: SplitButtonProps) {
  const { className, onClick, ...rest } = buttonProps ?? {};

  return (
    <div className="peas-split-button">
      <Button
        {...rest}
        className={cn("peas-split-button__main", className)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick?.(event);
        }}
      >
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={menuButtonLabel}
            aria-haspopup="menu"
            className="peas-split-button__trigger"
            disabled={rest.disabled}
            size={rest.size}
            variant={rest.variant}
            type="button"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={cn("peas-split-button__menu", menuContentClassName)}
        >
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SplitButtonMenuItem({
  title,
  description,
  icon,
  onSelect,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenuItem
      className="peas-split-button-menu-item"
      onSelect={onSelect}
    >
      {icon}
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </DropdownMenuItem>
  );
}
