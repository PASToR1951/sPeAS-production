import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva("peas-ui-button", {
  variants: {
    variant: {
      default: "peas-ui-button--default",
      secondary: "peas-ui-button--secondary",
      outline: "peas-ui-button--outline",
      ghost: "peas-ui-button--ghost",
      destructive: "peas-ui-button--destructive",
      actionBlue: "peas-ui-button--action-blue",
      actionGreen: "peas-ui-button--action-green",
      actionRed: "peas-ui-button--action-red",
      actionPurple: "peas-ui-button--action-purple",
    },
    size: {
      default: "peas-ui-button--size-default",
      sm: "peas-ui-button--size-sm",
      lg: "peas-ui-button--size-lg",
      icon: "peas-ui-button--size-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
