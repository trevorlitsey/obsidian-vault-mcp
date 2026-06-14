#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ObsidianVaultMcpStack } from '../lib/stack';
import { GitHubOidcStack } from '../lib/github-oidc-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new ObsidianVaultMcpStack(app, 'ObsidianVaultMcpStack', {
  env,
  githubOauthClientId: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
});

new GitHubOidcStack(app, 'ObsidianVaultMcpOidcStack', {
  env,
  githubOrg: process.env.GITHUB_OIDC_ORG ?? 'trevorlitsey',
  githubRepo: process.env.GITHUB_OIDC_REPO ?? 'obsidian-vault-mcp',
  existingOidcProviderArn: app.node.tryGetContext('existingGitHubOidcProviderArn'),
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
