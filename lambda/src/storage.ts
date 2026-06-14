import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomBytes, createHash } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = requireEnv('TABLE_NAME');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export interface Stored {
  pk: string;
  expires_at?: number;
  [key: string]: unknown;
}

export async function putItem(item: Stored, ttlSeconds?: number): Promise<void> {
  if (ttlSeconds) item.expires_at = Math.floor(Date.now() / 1000) + ttlSeconds;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function getItem<T extends Stored = Stored>(pk: string): Promise<T | null> {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk } }));
  if (!Item) return null;
  if (typeof Item.expires_at === 'number' && Item.expires_at * 1000 < Date.now()) return null;
  return Item as T;
}

export async function deleteItem(pk: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk } }));
}

// Record types stored in the single table, keyed by pk = "<TYPE>#<id>".

export interface ClientRecord extends Stored {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
}

export interface AuthStateRecord extends Stored {
  state: string;
  client_id: string;
  client_redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  resource?: string;
  client_state?: string;
}

export interface RepoPickerSessionRecord extends Stored {
  picker_id: string;
  client_id: string;
  client_redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  resource?: string;
  client_state?: string;
  github_token: string;
}

export interface AuthCodeRecord extends Stored {
  code: string;
  client_id: string;
  client_redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  resource?: string;
  github_token: string;
  repo_owner: string;
  repo_name: string;
  repo_branch: string;
}

export interface SessionRecord extends Stored {
  access_token: string;
  client_id: string;
  github_token: string;
  repo_owner: string;
  repo_name: string;
  repo_branch: string;
  resource?: string;
}

export interface RefreshRecord extends Stored {
  refresh_token: string;
  client_id: string;
  github_token: string;
  repo_owner: string;
  repo_name: string;
  repo_branch: string;
  resource?: string;
}
