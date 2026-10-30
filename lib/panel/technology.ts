import type { KevStatEntry } from "../stats-schema";
import { addDays } from "../lifecycle";

/**
 * The attack surface: what CISA listed as exploited, by technology. Ordered
 * keyword rules over a KEV entry's vendor, product and name; the first rule
 * that matches wins, so the AI stack comes before the operating systems it
 * runs on and the network edge before the enterprise apps. An entry no rule
 * matches is "Other", kept in the data and hidden from the instrument when it
 * is empty. The rules sorted every KEV entry of the 90 days before
 * 2026-10-29; tests/panel.test.ts holds real rows for each. "Remote" alone is
 * not a remote-access tool: KEV names say "Remote Code Execution" for flaws in
 * anything.
 */

export const SURFACE_DAYS = 90;
/** Entries listed within this many days are drawn bright. */
export const SURFACE_RECENT_DAYS = 30;
export const OTHER_TECH = "Other";

export const TECH_RULES: readonly (readonly [string, RegExp])[] = [
  ["AI stack", /langflow|litellm|berriai|vllm|ollama|open ?webui|flowise|llama|\bmcp\b|langchain|gradio|\bray\b|mlflow|comfyui|hugging/],
  [
    "Network edge & VPN",
    /cisco|fortinet|forti\w*|palo alto|pan-os|citrix|netscaler|ivanti|sonicwall|check point|\bf5\b|big-ip|juniper|zyxel|mikrotik|ubiquiti|unifi|arista|velocloud|draytek|tp-link|d-link|netgear|sophos|watchguard|array networks|barracuda|lantronix|dd-wrt|firewall|vpn|router|sd-?wan|gateway/,
  ],
  ["Remote access & IT tools", /connectwise|screenconnect|simplehelp|n-able|n-central|beyondtrust|solarwinds|kaseya|anydesk|teamviewer|\brmm\b|remote (support|access|desktop|management|monitoring)|ahsay|veeam|backup|splunk|daemon tools/],
  ["Operating systems", /windows|linux|kernel|macos|apple|android|pixel|ios\b|chrome os|uefi|vmware|esxi|broadcom|red hat|hypervisor|win32k/],
  ["Browsers", /chrom|firefox|mozilla|safari|webkit|\bv8\b|internet explorer|\bedge\b/],
  [
    "Enterprise & web apps",
    /microsoft|sharepoint|exchange|office|outlook|oracle|peoplesoft|\bsap\b|atlassian|confluence|jira|gitlab|gitea|adobe|magento|wordpress|joomla|drupal|zimbra|synacor|smartermail|smartertools|papercut|plex|jenkins|teamcity|jetbrains|php|apache|tomcat|zammad|trueconf|artifactory|jfrog|sangoma|freepbx|roundcube|craft ?cms|sitecore|progress|moveit|telerik|dell|\bhpe?\b|ibm|samsung|zoho|manageengine|commvault|erlang|nginx|cyberpanel|cpanel|litespeed|elastic|grafana|collabora|owncloud|metabase|strapi|wso2|kestra|starlette|proftpd|\bbind\b|siteguard|windchill|page builder|forms|icagenda|ajax\.net|brotli|tanstack|nx console|mirasvit/,
  ],
  ["OT & IoT", /siemens|schneider|rockwell|scada|\bics\b|\bplc\b|\biot\b|camera|dahua|hikvision|\bnas\b|qnap|synology|\baxis\b|edimax|digiever|geovision|vivotek|\bknx\b/],
];

export function techOf(e: Pick<KevStatEntry, "vendor" | "product" | "name">): string {
  const t = `${e.vendor} ${e.product} ${e.name}`.toLowerCase();
  return TECH_RULES.find(([, rx]) => rx.test(t))?.[0] ?? OTHER_TECH;
}

export interface SurfaceRow {
  label: string;
  /** KEV entries listed in the 90 days. */
  n: number;
  /** Of them, listed in the last 30 days. */
  recent: number;
}

/** KEV entries listed in the 90 days up to today, by technology, most first; Other last and only when it holds any. */
export function buildSurface(entries: readonly KevStatEntry[], today: string): SurfaceRow[] {
  const from = addDays(today, -SURFACE_DAYS);
  const recentFrom = addDays(today, -SURFACE_RECENT_DAYS);
  const rows = new Map<string, SurfaceRow>();
  for (const e of entries) {
    if (e.added <= from || e.added > today) continue;
    const label = techOf(e);
    const r = rows.get(label) ?? { label, n: 0, recent: 0 };
    r.n += 1;
    if (e.added > recentFrom) r.recent += 1;
    rows.set(label, r);
  }
  return [...rows.values()].sort((a, b) => (a.label === OTHER_TECH ? 1 : b.label === OTHER_TECH ? -1 : b.n - a.n || a.label.localeCompare(b.label)));
}
