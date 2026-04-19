import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Boxed, filled, sharp — values in monospace.
          "flex w-full bg-surface text-fg placeholder:text-muted",
          "border border-line rounded-md",
          "h-14 px-4 py-3 text-base font-mono",
          "focus-visible:outline-none focus-visible:border-acid focus-visible:ring-1 focus-visible:ring-acid",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
