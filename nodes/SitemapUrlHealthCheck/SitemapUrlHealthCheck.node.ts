import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const API_BASE = 'https://api.apify.com';
const ACTOR_ID = 'lineagersiui~sitemap-url-health-checker';
const TERMINAL = ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'];
const CREDENTIAL = 'apifySitemapHealthApi';

interface ResultItem extends IDataObject {
	url?: string;
	status?: number | null;
	finalUrl?: string | null;
	flags?: string[];
}

export function splitList(value: string): string[] {
	return String(value || '')
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function parseFlagList(value: string): string[] {
	return splitList(value).filter((s) => s.toLowerCase() !== 'none');
}

/** Same counting rules as the GitHub Action's evaluate.jq and the npm CLI. */
export function evaluateResults(items: ResultItem[], failOn: string[], summary: IDataObject) {
	const fail = new Set(failOn);
	const flagsOf = (it: ResultItem) => (Array.isArray(it.flags) ? it.flags : []);
	const marked = items.map((it) => ({ ...it, fail: flagsOf(it).some((f) => fail.has(f)) }));
	const failingRows = marked.filter((m) => m.fail);
	const problemRows = marked
		.filter((m) => !flagsOf(m).includes('ok'))
		.sort((a, b) => (a.fail === b.fail ? 0 : a.fail ? -1 : 1));
	return {
		checked: typeof summary.checked === 'number' ? summary.checked : items.length,
		problems: typeof summary.problems === 'number' ? summary.problems : problemRows.length,
		failing: failingRows.length,
		billed: typeof summary.billed === 'number' ? summary.billed : null,
		blockedByRobots: typeof summary.blockedByRobots === 'number' ? summary.blockedByRobots : 0,
		failOn: [...fail],
		problemRows,
	};
}

export class SitemapUrlHealthCheck implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sitemap URL Health Check',
		name: 'sitemapUrlHealthCheck',
		icon: { light: 'file:sitemapUrlHealthCheck.svg', dark: 'file:sitemapUrlHealthCheck.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["siteUrls"] || $parameter["sitemapUrls"]}}',
		description:
			'Check every URL in a sitemap for 404s, server errors, redirects and noindex headers (Apify Actor, $0.0005 per URL checked)',
		defaults: {
			name: 'Sitemap URL Health Check',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: CREDENTIAL,
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'Runs the Apify Actor lineagersiui/sitemap-url-health-checker on your Apify account. Each URL that returns an HTTP status is billed at $0.0005 (1,000 URLs = $0.50), plus Apify platform usage. The node author built the Actor and earns these fees.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Sites',
				name: 'siteUrls',
				type: 'string',
				default: '',
				placeholder: 'example.com',
				description:
					'Site addresses, comma-separated (up to 10). The sitemap is found from robots.txt or /sitemap.xml.',
			},
			{
				displayName: 'Sitemap URLs',
				name: 'sitemapUrls',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/sitemap.xml',
				description:
					'Direct sitemap, sitemap-index, .xml.gz or plain-text list URLs, comma-separated (up to 10)',
			},
			{
				displayName: 'I Own These Sites or Have Permission to Check Them',
				name: 'confirmPermission',
				type: 'boolean',
				default: false,
				required: true,
				description:
					'Whether you own the sites or have permission to check them. The Actor refuses runs without this confirmation.',
			},
			{
				displayName: 'Max URLs',
				name: 'maxUrls',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 5000 },
				default: 500,
				description: 'Hard cap on URLs checked (and billed) per run, 1 to 5,000',
			},
			{
				displayName: 'Fail On',
				name: 'failOn',
				type: 'string',
				default: 'not_found,server_error,client_error',
				description:
					'Comma-separated flags that count as failing, e.g. not_found, client_error, server_error, redirect_chain, https_downgrade, noindex_header. Leave empty to never fail.',
			},
			{
				displayName: 'Error When Fail-On Flags Match',
				name: 'errorOnFailing',
				type: 'boolean',
				default: false,
				description:
					'Whether to stop the workflow with an error when at least one URL matches Fail On. When off, check the "failing" field instead.',
			},
			{
				displayName: 'Output',
				name: 'output',
				type: 'options',
				options: [
					{
						name: 'Summary',
						value: 'summary',
						description: 'One item with counts and the list of problem URLs',
					},
					{
						name: 'One Item per Problem URL',
						value: 'rows',
						description: 'One item for each URL with a problem',
					},
				],
				default: 'summary',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Healthy URLs',
						name: 'includeHealthy',
						type: 'boolean',
						default: false,
						description:
							'Whether the Actor should also return URLs that answered 2xx without redirects. They are checked and billed either way.',
					},
					{
						displayName: 'Time Limit (Seconds)',
						name: 'timeLimitSecs',
						type: 'number',
						typeOptions: { minValue: 60, maxValue: 3600 },
						default: 1500,
						description: 'The run stops starting new checks after this time',
					},
					{
						displayName: 'Max Wait (Seconds)',
						name: 'maxWaitSecs',
						type: 'number',
						typeOptions: { minValue: 60, maxValue: 7200 },
						default: 4200,
						description: 'Stop waiting for the run after this time',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const api = async (method: IHttpRequestMethods, path: string, body?: IDataObject) =>
			(await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, {
				method,
				url: `${API_BASE}${path}`,
				body,
				json: true,
				timeout: 120000,
			})) as IDataObject;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const siteUrls = splitList(this.getNodeParameter('siteUrls', itemIndex, '') as string);
				const sitemapUrls = splitList(this.getNodeParameter('sitemapUrls', itemIndex, '') as string);
				const confirmPermission = this.getNodeParameter('confirmPermission', itemIndex, false) as boolean;
				const maxUrls = this.getNodeParameter('maxUrls', itemIndex, 500) as number;
				const failOn = parseFlagList(this.getNodeParameter('failOn', itemIndex, '') as string);
				const errorOnFailing = this.getNodeParameter('errorOnFailing', itemIndex, false) as boolean;
				const output = this.getNodeParameter('output', itemIndex, 'summary') as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

				if (siteUrls.length + sitemapUrls.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Give at least one site or sitemap URL', { itemIndex });
				}
				if (siteUrls.length > 10 || sitemapUrls.length > 10) {
					throw new NodeOperationError(this.getNode(), 'At most 10 site URLs and 10 sitemap URLs per run', {
						itemIndex,
					});
				}
				if (!confirmPermission) {
					throw new NodeOperationError(
						this.getNode(),
						'Confirm that you own these sites or have permission to check them',
						{ itemIndex },
					);
				}

				const input: IDataObject = {
					confirmPermission: true,
					maxUrls,
					onlyProblems: !(options.includeHealthy as boolean),
				};
				if (siteUrls.length) input.siteUrls = siteUrls;
				if (sitemapUrls.length) input.sitemapUrls = sitemapUrls;
				if (options.timeLimitSecs !== undefined) input.timeLimitSecs = options.timeLimitSecs;
				const maxWaitSecs = (options.maxWaitSecs as number) || 4200;

				const started = (await api('POST', `/v2/acts/${ACTOR_ID}/runs`, input)).data as IDataObject;
				const runId = started.id as string;
				let run = started;
				const startedAt = Date.now();
				while (!TERMINAL.includes(run.status as string)) {
					if ((Date.now() - startedAt) / 1000 > maxWaitSecs) {
						throw new NodeOperationError(this.getNode(), `Gave up waiting for Apify run ${runId}`, { itemIndex });
					}
					// waitForFinish makes the API hold the request for up to 60 s, so no local timer is needed.
					run = (await api('GET', `/v2/actor-runs/${runId}?waitForFinish=60`)).data as IDataObject;
				}
				if (run.status !== 'SUCCEEDED') {
					throw new NodeOperationError(
						this.getNode(),
						`Apify run ${runId} ended with status ${run.status as string}. ${String(run.statusMessage || '').slice(0, 300)}`,
						{ itemIndex },
					);
				}

				let summary: IDataObject = {};
				try {
					const s = await api('GET', `/v2/key-value-stores/${run.defaultKeyValueStoreId as string}/records/SUMMARY`);
					if (s && typeof s === 'object' && !Array.isArray(s)) summary = s;
				} catch {
					summary = {};
				}

				const rows: ResultItem[] = [];
				for (let offset = 0; ; offset += 1000) {
					const page = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, {
						method: 'GET',
						url: `${API_BASE}/v2/datasets/${run.defaultDatasetId as string}/items?format=json&clean=true&offset=${offset}&limit=1000`,
						json: true,
						timeout: 120000,
					})) as ResultItem[];
					rows.push(...page);
					if (page.length < 1000) break;
				}

				const result = evaluateResults(rows, failOn, summary);
				if (errorOnFailing && result.failing > 0) {
					throw new NodeOperationError(
						this.getNode(),
						`${result.failing} sitemap URL(s) matched Fail On (${failOn.join(', ')}). Apify run ${runId}.`,
						{ itemIndex },
					);
				}

				if (output === 'rows') {
					for (const row of result.problemRows) {
						returnData.push({ json: { ...row, runId }, pairedItem: { item: itemIndex } });
					}
				} else {
					returnData.push({
						json: {
							runId,
							datasetId: run.defaultDatasetId,
							checked: result.checked,
							problems: result.problems,
							failing: result.failing,
							billed: result.billed,
							blockedByRobots: result.blockedByRobots,
							failOn: result.failOn,
							problemUrls: result.problemRows,
						},
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: itemIndex } });
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error.message, { itemIndex });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [returnData];
	}
}
