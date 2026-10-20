import type { GlyphController } from "@/components/fx/glyph/engine";
import type { Emit } from "@/components/fx/glyph/scenes/kit";
import type { ThreatIntel } from "@/lib/threatIntel";

/** A hero scene on the review page. */
export interface SceneEntry {
  id: string;
  letter: string;
  title: string;
  note: string;
  make: (o: { intel: ThreatIntel; emit?: Emit }) => GlyphController;
  label: string;
  /** CSS px per glyph cell, when the scene wants finer (or coarser) glyphs than the default 6 */
  cell?: number;
}
