import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-fg text-bg hover:bg-fg/90",
        quiet: "bg-transparent text-fg hover:bg-raised",
        danger: "bg-transparent text-negative hover:bg-raised",
      },
      size: {
        md: "h-11 px-4 text-sm",
        icon: "size-11 shrink-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
