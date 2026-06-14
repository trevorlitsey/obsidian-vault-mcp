import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface ObsidianVaultMcpStackProps extends cdk.StackProps {
  vaultRepoOwner: string;
  vaultRepoName: string;
  vaultBranch: string;
}

export class ObsidianVaultMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObsidianVaultMcpStackProps) {
    super(scope, id, props);

    const githubTokenSecret = new secretsmanager.Secret(this, 'GitHubToken', {
      description: 'GitHub PAT for vault repo access',
    });

    const bearerTokenSecret = new secretsmanager.Secret(this, 'BearerToken', {
      description: 'Bearer token clients use to call the MCP endpoint',
    });

    const handler = new NodejsFunction(this, 'McpHandler', {
      entry: path.join(__dirname, '../lambda/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GITHUB_TOKEN_SECRET_ARN: githubTokenSecret.secretArn,
        BEARER_TOKEN_SECRET_ARN: bearerTokenSecret.secretArn,
        VAULT_REPO_OWNER: props.vaultRepoOwner,
        VAULT_REPO_NAME: props.vaultRepoName,
        VAULT_BRANCH: props.vaultBranch,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
      },
    });

    githubTokenSecret.grantRead(handler);
    bearerTokenSecret.grantRead(handler);

    const fnUrl = handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'McpEndpoint', { value: fnUrl.url });
    new cdk.CfnOutput(this, 'GitHubTokenSecretArn', { value: githubTokenSecret.secretArn });
    new cdk.CfnOutput(this, 'BearerTokenSecretArn', { value: bearerTokenSecret.secretArn });
  }
}
