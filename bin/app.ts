#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ObsidianVaultMcpStack } from '../lib/stack';

const app = new cdk.App();

new ObsidianVaultMcpStack(app, 'ObsidianVaultMcpStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  githubOauthClientId: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
