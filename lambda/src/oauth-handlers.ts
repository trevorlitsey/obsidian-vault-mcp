import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  putItem,
  getItem,
  deleteItem,
  randomToken,
  sha256Base64Url,
  type ClientRecord,
  type AuthStateRecord,
  type RepoPickerSessionRecord,
  type AuthCodeRecord,
  type SessionRecord,
  type RefreshRecord,
} from './storage.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  listUserRepos,
  getRepoDefaultBranch,
} from './github-oauth.js';
import { renderRepoPicker } from './repo-picker.js';

const ACCESS_TTL = 60 * 60; // 1 hour
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30 days
const CODE_TTL = 10 * 60;
const STATE_TTL = 10 * 60;
const PICKER_TTL = 30 * 60;
const CLIENT_TTL = 60 * 60 * 24 * 365;

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function html(status: number, body: string): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body,
  };
}

function redirect(location: string): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { location, 'cache-control': 'no-store' }, body: '' };
}

function parseForm(body: string | undefined, isBase64: boolean): Record<string, string> {
  if (!body) return {};
  const raw = isBase64 ? Buffer.from(body, 'base64').toString('utf-8') : body;
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

function selfBaseUrl(): string {
  const v = process.env.SELF_URL;
  if (!v) throw new Error('Missing env var: SELF_URL');
  return v.replace(/\/$/, '');
}

function callbackUrl(): string {
  return `${selfBaseUrl()}/callback`;
}

export function oauthProtectedResource(): APIGatewayProxyResultV2 {
  const base = selfBaseUrl();
  return json(200, {
    resource: base,
    authorization_servers: [base],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
  });
}

export function oauthAuthorizationServer(): APIGatewayProxyResultV2 {
  const base = selfBaseUrl();
  return json(200, {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
}

export async function register(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!event.body) return json(400, { error: 'invalid_request', error_description: 'Missing body' });
  let payload: { redirect_uris?: unknown; client_name?: unknown };
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'invalid_request', error_description: 'Body must be JSON' });
  }
  if (!Array.isArray(payload.redirect_uris) || payload.redirect_uris.length === 0) {
    return json(400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris required' });
  }
  const redirectUris = payload.redirect_uris.map(String);
  const clientId = randomToken(16);
  const record: ClientRecord = {
    pk: `CLIENT#${clientId}`,
    client_id: clientId,
    client_name: typeof payload.client_name === 'string' ? payload.client_name : undefined,
    redirect_uris: redirectUris,
    created_at: Math.floor(Date.now() / 1000),
  };
  await putItem(record, CLIENT_TTL);
  return json(201, {
    client_id: clientId,
    client_id_issued_at: record.created_at,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}

export async function authorize(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters ?? {};
  const clientId = q.client_id;
  const redirectUri = q.redirect_uri;
  const codeChallenge = q.code_challenge;
  const codeChallengeMethod = q.code_challenge_method;
  const responseType = q.response_type;

  if (!clientId || !redirectUri || !codeChallenge) {
    return json(400, { error: 'invalid_request', error_description: 'client_id, redirect_uri, code_challenge required' });
  }
  if (responseType !== 'code') {
    return json(400, { error: 'unsupported_response_type' });
  }
  if (codeChallengeMethod !== 'S256') {
    return json(400, { error: 'invalid_request', error_description: 'Only S256 supported' });
  }

  const client = await getItem<ClientRecord>(`CLIENT#${clientId}`);
  if (!client) return json(400, { error: 'invalid_client' });
  if (!client.redirect_uris.includes(redirectUri)) {
    return json(400, { error: 'invalid_redirect_uri' });
  }

  const state = randomToken(16);
  const record: AuthStateRecord = {
    pk: `STATE#${state}`,
    state,
    client_id: clientId,
    client_redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: q.resource,
    client_state: q.state,
  };
  await putItem(record, STATE_TTL);
  return redirect(buildAuthorizeUrl(state, callbackUrl()));
}

export async function callback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters ?? {};
  const code = q.code;
  const state = q.state;
  if (!code || !state) {
    return html(400, '<h1>Missing code or state from GitHub callback</h1>');
  }
  const stateRecord = await getItem<AuthStateRecord>(`STATE#${state}`);
  if (!stateRecord) {
    return html(400, '<h1>Authorization request expired or unknown. Please retry from the client.</h1>');
  }
  await deleteItem(`STATE#${state}`);

  const githubToken = await exchangeCodeForToken(code, callbackUrl());
  const repos = await listUserRepos(githubToken);

  const pickerId = randomToken(16);
  const picker: RepoPickerSessionRecord = {
    pk: `PICKER#${pickerId}`,
    picker_id: pickerId,
    client_id: stateRecord.client_id,
    client_redirect_uri: stateRecord.client_redirect_uri,
    code_challenge: stateRecord.code_challenge,
    code_challenge_method: 'S256',
    resource: stateRecord.resource,
    client_state: stateRecord.client_state,
    github_token: githubToken,
  };
  await putItem(picker, PICKER_TTL);

  return html(200, renderRepoPicker(pickerId, repos));
}

export async function selectRepo(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const form = parseForm(event.body, Boolean(event.isBase64Encoded));
  const pickerId = form.picker_id;
  const repoFullName = form.repo;
  if (!pickerId || !repoFullName) {
    return html(400, '<h1>Missing form fields</h1>');
  }
  const picker = await getItem<RepoPickerSessionRecord>(`PICKER#${pickerId}`);
  if (!picker) {
    return html(400, '<h1>Repo selection expired. Please retry from the client.</h1>');
  }
  await deleteItem(`PICKER#${pickerId}`);

  const [owner, name] = repoFullName.split('/');
  if (!owner || !name) return html(400, '<h1>Invalid repo selection</h1>');
  const branch = await getRepoDefaultBranch(picker.github_token, owner, name);

  const authCode = randomToken();
  const codeRecord: AuthCodeRecord = {
    pk: `CODE#${authCode}`,
    code: authCode,
    client_id: picker.client_id,
    client_redirect_uri: picker.client_redirect_uri,
    code_challenge: picker.code_challenge,
    code_challenge_method: 'S256',
    resource: picker.resource,
    github_token: picker.github_token,
    repo_owner: owner,
    repo_name: name,
    repo_branch: branch,
  };
  await putItem(codeRecord, CODE_TTL);

  const redirectTo = new URL(picker.client_redirect_uri);
  redirectTo.searchParams.set('code', authCode);
  if (picker.client_state) redirectTo.searchParams.set('state', picker.client_state);
  return redirect(redirectTo.toString());
}

export async function token(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const form = parseForm(event.body, Boolean(event.isBase64Encoded));
  const grantType = form.grant_type;
  if (grantType === 'authorization_code') return exchangeAuthorizationCode(form);
  if (grantType === 'refresh_token') return exchangeRefreshToken(form);
  return json(400, { error: 'unsupported_grant_type' });
}

async function exchangeAuthorizationCode(form: Record<string, string>): Promise<APIGatewayProxyResultV2> {
  const code = form.code;
  const verifier = form.code_verifier;
  const clientId = form.client_id;
  const redirectUri = form.redirect_uri;
  if (!code || !verifier || !clientId || !redirectUri) {
    return json(400, { error: 'invalid_request' });
  }
  const record = await getItem<AuthCodeRecord>(`CODE#${code}`);
  if (!record) return json(400, { error: 'invalid_grant' });
  await deleteItem(`CODE#${code}`);

  if (record.client_id !== clientId || record.client_redirect_uri !== redirectUri) {
    return json(400, { error: 'invalid_grant' });
  }
  if (sha256Base64Url(verifier) !== record.code_challenge) {
    return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }

  return issueTokens({
    clientId,
    githubToken: record.github_token,
    owner: record.repo_owner,
    name: record.repo_name,
    branch: record.repo_branch,
    resource: record.resource,
  });
}

async function exchangeRefreshToken(form: Record<string, string>): Promise<APIGatewayProxyResultV2> {
  const refreshToken = form.refresh_token;
  const clientId = form.client_id;
  if (!refreshToken || !clientId) return json(400, { error: 'invalid_request' });
  const record = await getItem<RefreshRecord>(`REFRESH#${refreshToken}`);
  if (!record || record.client_id !== clientId) return json(400, { error: 'invalid_grant' });
  await deleteItem(`REFRESH#${refreshToken}`);

  return issueTokens({
    clientId,
    githubToken: record.github_token,
    owner: record.repo_owner,
    name: record.repo_name,
    branch: record.repo_branch,
    resource: record.resource,
  });
}

async function issueTokens(args: {
  clientId: string;
  githubToken: string;
  owner: string;
  name: string;
  branch: string;
  resource?: string;
}): Promise<APIGatewayProxyResultV2> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const session: SessionRecord = {
    pk: `SESSION#${accessToken}`,
    access_token: accessToken,
    client_id: args.clientId,
    github_token: args.githubToken,
    repo_owner: args.owner,
    repo_name: args.name,
    repo_branch: args.branch,
    resource: args.resource,
  };
  const refresh: RefreshRecord = {
    pk: `REFRESH#${refreshToken}`,
    refresh_token: refreshToken,
    client_id: args.clientId,
    github_token: args.githubToken,
    repo_owner: args.owner,
    repo_name: args.name,
    repo_branch: args.branch,
    resource: args.resource,
  };
  await Promise.all([putItem(session, ACCESS_TTL), putItem(refresh, REFRESH_TTL)]);

  return json(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope: 'mcp',
  });
}

export async function loadSession(accessToken: string): Promise<SessionRecord | null> {
  return getItem<SessionRecord>(`SESSION#${accessToken}`);
}
