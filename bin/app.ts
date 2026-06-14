#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ObsidianVaultMcpStack } from '../lib/stack';

const app = new cdk.App();

new ObsidianVaultMcpStack(app, 'ObsidianVaultMcpStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vaultRepoOwner: requireEnv('VAULT_REPO_OWNER'),
  vaultRepoName: requireEnv('VAULT_REPO_NAME'),
  vaultBranch: process.env.VAULT_BRANCH ?? 'main',
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
