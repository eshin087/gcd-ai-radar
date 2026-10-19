# Data licence

The gcd AI Radar dataset (everything under `/data`, and the copies served at
`/data/*.json` and `/data/*.csv` on the site) is licensed under the
**Creative Commons Attribution-ShareAlike 4.0 International** licence
(CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/

You may copy, redistribute and adapt the data, including commercially, as long
as you credit "gcd AI Radar" with a link to the site, indicate changes, and
release derivative datasets under the same licence.

## Why share-alike

Some records are derived from the AI Incident Database, whose incident metadata
is CC BY-SA 4.0. Rather than track licences per record, the whole dataset
carries the same terms.

## Upstream attribution

Records built from these sources carry their origin in the `origin` field.
When you redistribute the data, keep these notices:

- **AI Incident Database** (incidentdatabase.ai), CC BY-SA 4.0. McGregor, S. (2021)
  "Preventing Repeated Real World AI Failures by Cataloging Incidents: The AI Incident Database."
- **MITRE ATLAS** (atlas.mitre.org), Apache 2.0. © 2021-2026 The MITRE Corporation.
  Case studies, and the technique ids and names in the `atlas` export column.
- **OWASP Top 10 for LLM Applications 2025** (genai.owasp.org), CC BY-SA 4.0. © OWASP Foundation.
  Entry ids and names in the `owasp_llm` export column. The mapping from categories to OWASP
  entries and ATLAS techniques is gcd AI Radar's own and is not endorsed by OWASP or MITRE.
- **AVID, the AI Vulnerability Database** (avidml.org), MIT.
- **NVD**: "This product uses the NVD API but is not endorsed or certified by the NVD."
- **GitHub Advisory Database** (github.com/advisories), CC BY 4.0.
- **CISA Known Exploited Vulnerabilities Catalog**, CC0 1.0.
- **arXiv**: "Thank you to arXiv for use of its open access interoperability." Metadata CC0 1.0.
- **GDELT Project** (gdeltproject.org): discovery of news coverage.
- **Hacker News via Algolia**: discovery of coverage; HN content belongs to its authors.
- **Cloudflare Radar** (radar.cloudflare.com), CC BY-NC 4.0, shown only on the site sidebar and not part of the dataset.

Every incident record also lists its `sources`: titles, publishers, dates and
links to the original reporting, which remain the property of their publishers.
Summaries are written by gcd AI Radar in its own words.
