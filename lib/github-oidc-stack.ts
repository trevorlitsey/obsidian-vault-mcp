import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubOidcStackProps extends cdk.StackProps {
  githubOrg: string;
  githubRepo: string;
  /**
   * If your account already has a GitHub Actions OIDC provider (only one per
   * account is allowed), pass its ARN as CDK context:
   * `cdk deploy -c existingGitHubOidcProviderArn=arn:aws:iam::...`.
   */
  existingOidcProviderArn?: string;
}

export class GitHubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const provider = props.existingOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GitHubOidcProvider',
          props.existingOidcProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'ObsidianVaultMcpDeployRole',
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:*`,
        },
      }),
      description: 'Assumed by GitHub Actions to run cdk deploy for obsidian-vault-mcp',
    });

    // CDK deploys work by assuming the bootstrap roles (cdk-*) in the target
    // account; granting this single permission keeps the role least-privilege.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
