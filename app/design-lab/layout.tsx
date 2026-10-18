import type { Metadata } from "next";
import "./lab.css";

export const metadata: Metadata = {
  title: "Design lab",
  robots: { index: false, follow: false },
};

// Text that forms on arrival (AsciiForm) starts hidden from first paint, so it
// never flashes in full first; without JS the noscript rule shows it as is.
const HIDE_PENDING = ".ascii-form[data-pending] [data-c]{color:transparent}";
const SHOW_PENDING = ".ascii-form[data-pending] [data-c]{color:inherit!important}";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{HIDE_PENDING}</style>
      <noscript>
        <style>{SHOW_PENDING}</style>
      </noscript>
      {children}
    </>
  );
}
