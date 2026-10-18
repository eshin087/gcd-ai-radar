import type { ReactNode } from "react";

interface ChartFrameProps {
  title?: string;
  subtitle?: string;
  /** Right-aligned slot for toggles, legends or a number. */
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove the panel chrome (for layouts that draw their own containers). */
  bare?: boolean;
}

/**
 * Panel around a chart. Charts render client-side; the fixed heights set by
 * each chart keep the layout from shifting while they mount.
 */
export function ChartFrame({ title, subtitle, aside, footer, children, className = "", bare = false }: ChartFrameProps) {
  return (
    <section className={`${bare ? "" : "panel p-4 sm:p-5"} flex flex-col gap-3 ${className}`}>
      {(title || aside) && (
        <header className="flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[13px] font-medium text-ink leading-tight">{title}</h2>}
            {subtitle && <p className="label mt-1 normal-case tracking-normal text-[11px]">{subtitle}</p>}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </header>
      )}
      <div className="min-w-0">{children}</div>
      {footer && <footer className="text-[11px] text-dim">{footer}</footer>}
    </section>
  );
}
