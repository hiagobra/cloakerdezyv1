import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline" | "link";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-strong active:translate-y-px shadow-[0_8px_24px_-8px_rgba(168,255,0,0.5)]",
  ghost:
    "bg-transparent text-foreground hover:bg-card-soft",
  outline:
    "bg-transparent text-foreground border border-border-strong hover:border-primary/60 hover:bg-card-soft",
  link:
    "bg-transparent text-primary hover:text-primary-strong underline-offset-4 hover:underline px-0 py-0",
};

const sizes: Record<Size, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-base",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const sizeClass = variant === "link" ? "" : sizes[size];
  return (
    <button
      className={`${base} ${variants[variant]} ${sizeClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

type LinkButtonProps = CommonProps & {
  href: string;
  prefetch?: boolean;
};

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  href,
  prefetch,
  children,
}: LinkButtonProps) {
  const sizeClass = variant === "link" ? "" : sizes[size];
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={`${base} ${variants[variant]} ${sizeClass} ${className}`}
    >
      {children}
    </Link>
  );
}
