import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export interface PeasActionMenuItem {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

interface PeasActionMenuProps {
  label: string;
  items: PeasActionMenuItem[];
}

export function PeasActionMenu({ label, items }: PeasActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={label} size="icon" variant="ghost">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            destructive={item.destructive}
            key={item.label}
            onSelect={item.onSelect}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
