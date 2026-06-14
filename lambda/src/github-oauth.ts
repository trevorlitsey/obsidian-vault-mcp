import { Octokit } from '@octokit/rest';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

let cachedClientSecret: string | undefined;

export function clientId(): string {
  const v = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!v) throw new Error('Missing env var: GITHUB_OAUTH_CLIENT_ID');
  return v;
}

async function clientSecret(): Promise<string> {
  if (cachedClientSecret) return cachedClientSecret;
  const name = process.env.GITHUB_OAUTH_CLIENT_SECRET_PARAM;
  if (!name) throw new Error('Missing env var: GITHUB_OAUTH_CLIENT_SECRET_PARAM');
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  if (!result.Parameter?.Value) throw new Error(`SSM parameter ${name} has no value`);
  cachedClientSecret = result.Parameter.Value;
  return cachedClientSecret;
}

export function buildAuthorizeUrl(state: string, redirectUri: string, scope = 'repo'): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const secret = await clientSecret();
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: secret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data.error_description ?? data.error ?? 'no token returned'}`);
  }
  return data.access_token;
}

export interface RepoChoice {
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
}

export async function listUserRepos(token: string): Promise<RepoChoice[]> {
  const octokit = new Octokit({ auth: token });
  const out: RepoChoice[] = [];
  for await (const page of octokit.paginate.iterator(octokit.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'updated',
    affiliation: 'owner,collaborator',
  })) {
    for (const r of page.data) {
      out.push({
        full_name: r.full_name,
        owner: r.owner.login,
        name: r.name,
        default_branch: r.default_branch ?? 'main',
        private: r.private,
      });
    }
    if (out.length >= 200) break;
  }
  return out;
}

export async function getRepoDefaultBranch(token: string, owner: string, name: string): Promise<string> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.get({ owner, repo: name });
  return data.default_branch;
}
