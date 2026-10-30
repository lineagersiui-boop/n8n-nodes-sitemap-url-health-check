# n8n-nodes-sitemap-url-health-check

An [n8n](https://n8n.io/) community node that checks every URL listed in a website's XML sitemap and reports 404/410s, other 4xx errors, 5xx server errors, redirects, redirect chains, https-to-http downgrades and `X-Robots-Tag: noindex` headers.

The checking runs in the Apify Actor [`lineagersiui/sitemap-url-health-checker`](https://apify.com/lineagersiui/sitemap-url-health-checker) on **your own Apify account**, using your Apify API token. The node starts the run, waits for it to finish and returns the results to your workflow. Typical uses: a weekly sitemap check that posts broken URLs to Slack or email, or a check after each deploy or CMS migration.

[Installation](#installation) · [Credentials](#credentials) · [Usage](#usage) · [Cost](#cost) · [Disclosure](#disclosure)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n documentation. In n8n: **Settings > Community Nodes > Install**, then enter `n8n-nodes-sitemap-url-health-check`.

## Credentials

The node uses an **Apify API** credential:

1. Create an Apify account at [apify.com](https://apify.com).
2. Copy your API token from Apify Console > Settings > Integrations.
3. In n8n, create a new **Apify API** credential and paste the token. n8n tests it against `GET https://api.apify.com/v2/users/me`.

Runs are billed to the Apify account that owns the token.

## Usage

| Parameter | Description |
|---|---|
| Sites | Site addresses, comma-separated (up to 10), e.g. `example.com`. The sitemap is found from robots.txt or `/sitemap.xml`. |
| Sitemap URLs | Direct sitemap, sitemap-index, `.xml.gz` or plain-text list URLs, comma-separated (up to 10). |
| I Own These Sites or Have Permission to Check Them | Required. The node refuses to run without it. Only check sites you own or have permission to check. |
| Max URLs | Hard cap on URLs checked and billed per run, 1 to 5,000 (default 500). |
| Fail On | Flags that count as failing (default `not_found,server_error,client_error`). Empty never fails. |
| Error When Fail-On Flags Match | Stop the workflow with an error when a URL matches Fail On. Otherwise read the `failing` field, for example in an IF node. |
| Output | **Summary**: one item with `checked`, `problems`, `failing`, `billed`, `runId`, `datasetId` and `problemUrls`. **One Item per Problem URL**: one item per URL with a problem. |
| Options | Include healthy URLs, Actor time limit, maximum wait. |

Each problem URL has `url`, `status`, `flags`, `redirects`, `redirectStatuses`, `finalUrl`, `lastmod`, `sitemap` and `fail` (true when it matched Fail On).

### Flags

| Flag | Meaning |
|---|---|
| `not_found` | 404 or 410 |
| `client_error` | Another 4xx |
| `server_error` | 5xx |
| `redirected` / `redirect_chain` / `too_many_redirects` | Redirects once, more than once, or more than 5 times |
| `https_downgrade` | An https URL redirects to http |
| `noindex_header` | Sends `X-Robots-Tag: noindex` |
| `blocked_by_robots` | robots.txt disallows the URL for this checker; skipped, not billed |
| `timeout` / `network_error` / `blocked_private_address` | Couldn't be checked; not billed |

### Example workflow

Schedule Trigger (weekly) > **Sitemap URL Health Check** (Output: Summary) > IF `{{$json.failing}} > 0` > Slack or Gmail node with `{{$json.problemUrls}}`.

A large sitemap can take several minutes to check. The node waits for the run to finish (up to the Max Wait option).

## Cost

The Actor is pay-per-event: **$0.0005 per URL checked** (1,000 URLs = $0.50), plus Apify platform usage, billed to your Apify account. URLs skipped by robots.txt, timeouts and network errors aren't billed. Max URLs is the hard cap per run. This node itself is free and MIT-licensed.

## Compatibility

Built with `@n8n/node-cli` 0.54 against `n8n-workflow` 2.x. No runtime dependencies.

## Disclosure

We built and maintain the Apify Actor this node calls, and we earn its pay-per-event fees ($0.0005 per URL checked). There are no affiliate or referral parameters. This package was written with AI assistance under the author's direction. It is not affiliated with or endorsed by Apify or n8n.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Actor page on Apify Store](https://apify.com/lineagersiui/sitemap-url-health-checker)
- [CLI version (npm)](https://www.npmjs.com/package/sitemap-url-health-check) · [GitHub Action](https://github.com/lineagersiui-boop/sitemap-url-health-check)

## License

[MIT](LICENSE.md)
