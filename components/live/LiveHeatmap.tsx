"use client";

import { useRouter } from "next/navigation";
import { CalendarHeatmap } from "@/components/charts/CalendarHeatmap";
import type { LiveData } from "@/lib/live";
import { THEME } from "@/lib/theme";

/**
 * The live page's calendar: shade is severity-weighted activity, a click opens
 * the incidents first reported on that day in the archive (only days that
 * had a report open, so the number in the tooltip is the list that opens).
 */
export function LiveHeatmap({ heatmap }: { heatmap: LiveData["heatmap"] }) {
  const router = useRouter();
  const dayCounts = Object.fromEntries(Object.entries(heatmap.cells).map(([day, c]) => [day, c.activity]));
  return (
    <CalendarHeatmap
      dayCounts={dayCounts}
      from={heatmap.from}
      to={heatmap.to}
      theme={THEME}
      label="Activity per day over the last twelve months, weighted by severity"
      describe={(day) => {
        const c = heatmap.cells[day];
        if (!c) return "nothing reported";
        return `${c.reported} reported · activity ${Number.isInteger(c.activity) ? c.activity : c.activity.toFixed(1)}`;
      }}
      canOpen={(day) => (heatmap.cells[day]?.reported ?? 0) > 0}
      onDay={(day) => router.push(`/incidents?by=reported&day=${day}`)}
      footnote="Shade is severity-weighted activity (4 real loss, 3 exploited, 2 disclosed, 1 research, plus half a point per later update). A day opens the incidents first reported on it."
    />
  );
}
