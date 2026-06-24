#!/usr/bin/env node
const endpoint = (process.env.MCP_ENDPOINT || 'https://ey4auttscc.execute-api.us-east-1.amazonaws.com').replace(/\/$/, '');

async function request(path, init = {}) {
  const res = await fetch(`${endpoint}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { res, text, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const protectedResource = await request('/.well-known/oauth-protected-resource');
assert(protectedResource.res.status === 200, `protected resource metadata returned ${protectedResource.res.status}`);
assert(protectedResource.json?.resource === endpoint, 'protected resource metadata has wrong resource URL');
assert(protectedResource.json?.authorization_servers?.includes(endpoint), 'protected resource metadata missing authorization server');

const authServer = await request('/.well-known/oauth-authorization-server');
assert(authServer.res.status === 200, `authorization server metadata returned ${authServer.res.status}`);
for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
  assert(typeof authServer.json?.[key] === 'string', `authorization server metadata missing ${key}`);
}
assert(authServer.json.issuer === endpoint, 'authorization server issuer mismatch');

const unauthMcp = await request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
assert(unauthMcp.res.status === 401, `unauthenticated /mcp returned ${unauthMcp.res.status}, expected 401`);
assert((unauthMcp.res.headers.get('www-authenticate') || '').includes('/.well-known/oauth-protected-resource'), 'www-authenticate header missing resource metadata');

const register = await request('/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'obsidian-vault-mcp-smoke-test',
    redirect_uris: ['https://example.com/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
});
assert(register.res.status === 201, `dynamic registration returned ${register.res.status}`);
assert(typeof register.json?.client_id === 'string' && register.json.client_id.length > 10, 'dynamic registration missing client_id');

console.log(JSON.stringify({ ok: true, endpoint, checks: ['protected-resource', 'authorization-server', 'mcp-unauthorized-challenge', 'dynamic-client-registration'] }, null, 2));
