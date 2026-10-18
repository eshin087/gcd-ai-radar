/**
 * Build-time OG/PNG chart images: satori renders a small flex layout plus
 * inline SVG shapes to SVG, sharp rasterizes it. No browser, no Recharts.
 * satori cannot render <text> inside <svg>, so every label is HTML.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import satori, { type Font } from "satori";
import sharp from "sharp";
import type { Incident } from "../lib/schema";
import { CATEGORY_COLORS, SEVERITY_COLORS, TREND_COLOR, TYPE_COLORS, UI, BAR_COLOR } from "../lib/palette";
import { SITE } from "../lib/site";
import {
  addTrend,
  categoryDistribution,
  headline,
  isRealWorld,
  monthlySeries,
  severityDistribution,
  shiftMonth,
  targetDistribution,
  toMonthKey,
  type MonthlyPoint,
} from "../lib/stats";
import { CATEGORY_META, INCIDENT_TYPES, SEVERITY_META, TARGET_META, TYPE_META } from "../lib/taxonomy";
import { monthLabel } from "../lib/format";

const W = 1200;
const H = 630;
const MONO = "IBM Plex Mono";

async function loadFonts(): Promise<Font[]> {
  const dir = path.join(process.cwd(), "public", "fonts");
  return [
    { name: MONO, data: await fs.readFile(path.join(dir, "IBMPlexMono-Medium.ttf")), weight: 500, style: "normal" },
    { name: MONO, data: await fs.readFile(path.join(dir, "IBMPlexMono-SemiBold.ttf")), weight: 600, style: "normal" },
  ];
}

interface Ctx {
  /** Incidents only: disclosed vulnerabilities are left out (lib/counting.ts). */
  incidents: Incident[];
  /** How many disclosed vulnerabilities were left out. */
  disclosed: number;
  now: Date;
  siteHost: string;
}

const base = { display: "flex" as const, fontFamily: MONO, color: UI.ink };

function Frame({ title, subtitle, children, ctx }: { title: string; subtitle: string; children: React.ReactNode; ctx: Ctx }) {
  return (
    <div style={{ ...base, flexDirection: "column", width: W - 112, height: H - 72, background: UI.ground, paddingTop: 40, paddingRight: 56, paddingBottom: 32, paddingLeft: 56, justifyContent: "space-between" }}>
      <div style={{ ...base, flexDirection: "column" }}>
        <div style={{ ...base, fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{title}</div>
        <div style={{ ...base, fontSize: 17, color: UI.dim, marginTop: 8 }}>{subtitle}</div>
      </div>
      <div style={{ ...base, flex: 1, marginTop: 24, marginBottom: 20 }}>{children}</div>
      <div style={{ ...base, justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ ...base, alignItems: "center", gap: 12 }}>
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke={UI.accent} strokeWidth="2.4" strokeLinecap="round">
            <circle cx="16" cy="16" r="13" opacity="0.35" />
            <circle cx="16" cy="16" r="7.5" opacity="0.6" />
            <path d="M16 16 L27 8.5" />
            <circle cx="16" cy="16" r="1.8" fill={UI.accent} stroke="none" />
          </svg>
          <div style={{ ...base, fontSize: 24, fontWeight: 600, letterSpacing: 2 }}>{SITE.wordmark}</div>
        </div>
        <div style={{ ...base, fontSize: 15, color: UI.accent }}>
          {ctx.siteHost} · {ctx.now.toISOString().slice(0, 10)}
        </div>
      </div>
    </div>
  );
}

/** Vertical bars with an optional trend line, drawn as SVG rects/paths. */
function Bars({ series, width, height, stacked, trend }: { series: MonthlyPoint[]; width: number; height: number; stacked?: boolean; trend?: boolean }) {
  const n = series.length;
  const max = Math.max(1, ...series.map((p) => p.total));
  const gap = 4;
  const bw = (width - gap * (n - 1)) / n;
  const t = trend ? addTrend(series) : null;
  const y = (v: number) => height - (v / max) * (height - 8);
  const linePath =
    t?.filter((p) => p.ma !== null).map((p, i) => `${i === 0 ? "M" : "L"}${(t.indexOf(p) * (bw + gap) + bw / 2).toFixed(1)},${y(p.ma!).toFixed(1)}`).join(" ") ?? "";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {series.map((p, i) => {
        const x = i * (bw + gap);
        if (!stacked) return <rect key={p.month} x={x} y={y(p.total)} width={bw} height={height - y(p.total)} fill={BAR_COLOR} rx={2} />;
        let acc = 0;
        return INCIDENT_TYPES.map((type) => {
          const v = p.byType[type];
          const top = y(acc + v);
          const h = y(acc) - top;
          acc += v;
          return <rect key={`${p.month}-${type}`} x={x} y={top} width={bw} height={Math.max(0, h)} fill={TYPE_COLORS[type]} />;
        });
      })}
      {trend && linePath && <path d={linePath} fill="none" stroke={TREND_COLOR} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

function AxisLabels({ series, width }: { series: MonthlyPoint[]; width: number }) {
  const picks = [0, Math.floor(series.length / 2), series.length - 1].map((i) => series[i]!.month);
  return (
    <div style={{ ...base, width, justifyContent: "space-between", fontSize: 14, color: UI.dim, marginTop: 8 }}>
      {picks.map((m) => (
        <div key={m} style={base}>
          {monthLabel(m)}
        </div>
      ))}
    </div>
  );
}

function HBars({ rows, width, color }: { rows: { label: string; value: number; color?: string }[]; width: number; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ ...base, flexDirection: "column", width, gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ ...base, alignItems: "center", gap: 16 }}>
          <div style={{ ...base, width: 300, fontSize: 18, color: UI.soft, justifyContent: "flex-end" }}>{r.label}</div>
          <div style={{ ...base, flex: 1, alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", width: `${(r.value / max) * 100}%`, height: 22, background: r.color ?? color ?? BAR_COLOR, borderRadius: 2 }} />
            <div style={{ ...base, fontSize: 18, color: UI.ink }}>{r.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ ...base, gap: 22, fontSize: 15, color: UI.soft, marginTop: 10 }}>
      {items.map((it) => (
        <div key={it.label} style={{ ...base, alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", width: 12, height: 12, background: it.color, borderRadius: 2 }} />
          <div style={base}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ ...base, flexDirection: "column", gap: 6 }}>
      <div style={{ ...base, fontSize: 13, color: UI.dim, letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ ...base, fontSize: 48, fontWeight: 600, color: accent ? UI.accent : UI.ink, letterSpacing: -1 }}>{value}</div>
    </div>
  );
}

function pct(n: number | null): string {
  if (n === null) return "new";
  return `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}%`;
}

export async function renderOgImages(ctx: Ctx, outDir: string): Promise<string[]> {
  const fonts = await loadFonts();
  await fs.mkdir(outDir, { recursive: true });
  const { incidents, now } = ctx;
  const to = toMonthKey(now);
  const from = shiftMonth(to, -23);
  const series = monthlySeries(incidents, { from, to });
  const recent = series.slice(-24);
  const h = headline(incidents, { now });
  const realCount = incidents.filter(isRealWorld).length;
  const chartW = W - 112;

  const images: Record<string, React.ReactNode> = {
    "default.png": (
      <Frame ctx={ctx} title={SITE.tagline} subtitle={`${monthLabel(recent[0]!.month, true)} to ${monthLabel(to, true)} · incidents per month, 3-month average in amber`}>
        <div style={{ ...base, flexDirection: "column", width: chartW, justifyContent: "space-between" }}>
          <div style={{ ...base, gap: 56 }}>
            <Stat label="incidents" value={h.total.toLocaleString("en-US")} />
            <Stat label="real-world · sev 3–4" value={realCount.toLocaleString("en-US")} accent />
            <Stat label="trailing 12 months" value={`${h.trailing12.toLocaleString("en-US")} ${pct(h.trailingDeltaPct)}`} />
          </div>
          <div style={{ ...base, flexDirection: "column" }}>
            <Bars series={recent} width={chartW} height={180} trend />
            <AxisLabels series={recent} width={chartW} />
          </div>
        </div>
      </Frame>
    ),
    "monthly.png": (
      <Frame ctx={ctx} title="AI security incidents per month" subtitle={`${monthLabel(from, true)} to ${monthLabel(to, true)} · by incident date · amber: 3-month average · last two months provisional`}>
        <div style={{ ...base, flexDirection: "column", width: chartW }}>
          <Bars series={series} width={chartW} height={300} trend />
          <AxisLabels series={series} width={chartW} />
        </div>
      </Frame>
    ),
    "types.png": (
      <Frame ctx={ctx} title="Attacks on AI vs AI-enabled attacks" subtitle={`${monthLabel(from, true)} to ${monthLabel(to, true)} · monthly, stacked`}>
        <div style={{ ...base, flexDirection: "column", width: chartW }}>
          <Bars series={series} width={chartW} height={280} stacked />
          <AxisLabels series={series} width={chartW} />
          <Legend items={INCIDENT_TYPES.map((t) => ({ label: TYPE_META[t].label, color: TYPE_COLORS[t] }))} />
        </div>
      </Frame>
    ),
    "categories.png": (
      <Frame ctx={ctx} title="Incidents by category" subtitle="primary category per incident · all time">
        <HBars
          width={chartW}
          rows={categoryDistribution(incidents)
            .filter((r) => r.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 9)
            .map((r) => ({ label: CATEGORY_META[r.key].label, value: r.count, color: CATEGORY_COLORS[r.key] }))}
        />
      </Frame>
    ),
    "targets.png": (
      <Frame ctx={ctx} title="Incidents by target" subtitle="an incident can hit several targets · all time">
        <HBars
          width={chartW}
          rows={targetDistribution(incidents)
            .filter((r) => r.count > 0)
            .slice(0, 9)
            .map((r) => ({ label: TARGET_META[r.key].label, value: r.count }))}
        />
      </Frame>
    ),
    "severity.png": (
      <Frame ctx={ctx} title="Severity distribution" subtitle="1 research · 2 disclosed vulnerability · 3 confirmed exploitation · 4 real-world loss">
        <HBars
          width={chartW}
          rows={severityDistribution(incidents).map((r) => ({
            label: `${r.key} ${SEVERITY_META[Number(r.key) as 1 | 2 | 3 | 4].label}`,
            value: r.count,
            color: SEVERITY_COLORS[Number(r.key) as 1 | 2 | 3 | 4],
          }))}
        />
      </Frame>
    ),
  };

  const written: string[] = [];
  for (const [file, node] of Object.entries(images)) {
    const svg = await satori(node as React.ReactElement, { width: W, height: H, fonts });
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    await fs.writeFile(path.join(outDir, file), png);
    written.push(file);
  }
  return written;
}
