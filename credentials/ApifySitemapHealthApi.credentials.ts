import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ApifySitemapHealthApi implements ICredentialType {
	name = 'apifySitemapHealthApi';

	displayName = 'Apify API';

	icon: Icon = {
		light: 'file:../nodes/SitemapUrlHealthCheck/sitemapUrlHealthCheck.svg',
		dark: 'file:../nodes/SitemapUrlHealthCheck/sitemapUrlHealthCheck.dark.svg',
	};

	documentationUrl = 'https://docs.apify.com/platform/integrations/api#api-token';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Apify API token from Apify Console > Settings > Integrations. Runs are billed to this Apify account.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.apify.com',
			url: '/v2/users/me',
			method: 'GET',
		},
	};
}
