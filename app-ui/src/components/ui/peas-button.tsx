import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

export function PeasButton(props: ButtonProps) {
  return <Button {...props} />;
}

interface PeasIconButtonProps extends ButtonProps {
  label: string;
  tooltip?: string;
  children: ReactNode;
}

export function PeasIconButton({ label, tooltip, children, ...props }: PeasIconButtonProps) {
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={label} size="icon" {...props}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
