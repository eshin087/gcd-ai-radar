import { lastActivity, type FullIncident } from "./lifecycle";
import { SITE } from "./site";
import { tagSlugsOf } from "./tags";
import { CATEGORY_META, LANE_META, PATCH_META, SEVERITY_META, TYPE_META } from "./taxonomy";

/**
 * The feeds: RSS 2.0 and JSON Feed 1.1 over a list of records, for the site,
 * each lane and each tag. One builder each, so every feed carries the same
 * fields in the same order.
 */

export const FEED_ITEMS = 50;

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export interface FeedChannel {
  title: string;
  description: string;
  /** The page the feed stands for. */
  homeUrl: string;
  /** The feed's own URL. */
  feedUrl: string;
  /** The last collector run, for lastBuildDate. */
  updated: string | null;
}

function itemText(i: FullIncident): string {
  const parts = [i.summary, i.action ? `Do: ${i.action}` : "", `Severity ${i.severity} (${SEVERITY_META[i.severity].label}). ${LANE_META[i.lane].label}; ${PATCH_META[i.patch_status].label}. ${TYPE_META[i.type].label}. ${i.source_count} source${i.source_count === 1 ? "" : "s"}.`];
  return parts.filter(Boolean).join(" ");
}

export function rssXml(incidents: readonly FullIncident[], site: string, channel: FeedChannel): string {
  const items = incidents
    .slice(0, FEED_ITEMS)
    .map((i) => {
      const url = `${site}/incidents/${i.slug}`;
      const cats = [LANE_META[i.lane].label, ...i.categories.map((c) => CATEGORY_META[c].label), ...tagSlugsOf(i)].map((c) => `<category>${escapeXml(c)}</category>`).join("");
      return `    <item>
      <title>${escapeXml(i.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="false">${escapeXml(i.id)}</guid>
      <pubDate>${new Date(`${i.first_reported}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(itemText(i))}</description>
      ${cats}
    </item>`;
    })
    .join("\n");
  const lastBuild = channel.updated ? new Date(channel.updated).toUTCString() : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.homeUrl)}</link>
    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(channel.description)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <copyright>Data CC BY-SA 4.0 · ${escapeXml(SITE.author)}</copyright>
${items}
  </channel>
</rss>
`;
}

export interface JsonFeed {
  version: "https://jsonfeed.org/version/1.1";
  title: string;
  home_page_url: string;
  feed_url: string;
  description: string;
  items: {
    id: string;
    url: string;
    title: string;
    content_text: string;
    date_published: string;
    date_modified: string;
    tags: string[];
    _radar: { lane: string; type: string; severity: number; state: string; patch_status: string; cve_ids: string[] };
  }[];
}

export function jsonFeed(incidents: readonly FullIncident[], site: string, channel: FeedChannel): JsonFeed {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: channel.title,
    home_page_url: channel.homeUrl,
    feed_url: channel.feedUrl,
    description: channel.description,
    items: incidents.slice(0, FEED_ITEMS).map((i) => ({
      id: i.id,
      url: `${site}/incidents/${i.slug}`,
      title: i.title,
      content_text: itemText(i),
      date_published: `${i.first_reported}T12:00:00Z`,
      date_modified: `${lastActivity(i)}T12:00:00Z`,
      tags: [i.lane, i.type, ...tagSlugsOf(i)],
      _radar: { lane: i.lane, type: i.type, severity: i.severity, state: i.state, patch_status: i.patch_status, cve_ids: i.cve_ids },
    })),
  };
}
