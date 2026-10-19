import { emphasis } from "@/lib/counting-rules";

/** A counting rule's text with its *emphasis* rendered (lib/counting-rules.ts). */
export function RuleText({ text }: { text: string }) {
  return (
    <>
      {emphasis(text).map((s, i) => (s.em ? <em key={i}>{s.text}</em> : <span key={i}>{s.text}</span>))}
    </>
  );
}
