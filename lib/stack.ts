import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ObsidianVaultMcpStackProps extends cdk.StackProps {
  githubOauthClientId: string;
}

const CLIENT_SECRET_PARAM_NAME = '/obsidian-vault-mcp/github-oauth-client-secret';

export class ObsidianVaultMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObsidianVaultMcpStackProps) {
    super(scope, id, props);

    const sessionTable = new dynamodb.Table(this, 'SessionTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const handler = new NodejsFunction(this, 'McpHandler', {
      entry: path.join(__dirname, '../lambda/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GITHUB_OAUTH_CLIENT_ID: props.githubOauthClientId,
        GITHUB_OAUTH_CLIENT_SECRET_PARAM: CLIENT_SECRET_PARAM_NAME,
        TABLE_NAME: sessionTable.tableName,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
      },
    });

    sessionTable.grantReadWriteData(handler);

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${CLIENT_SECRET_PARAM_NAME}`,
        ],
      }),
    );

    // The SSM parameter is stored as a SecureString encrypted with the
    // AWS-managed key alias/aws/ssm. Grant Decrypt scoped to that use.
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
        },
      }),
    );

    const fnUrl = handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    handler.addEnvironment('SELF_URL', fnUrl.url);

    new cdk.CfnOutput(this, 'McpEndpoint', { value: fnUrl.url });
    new cdk.CfnOutput(this, 'GitHubCallbackUrl', { value: `${fnUrl.url}callback` });
    new cdk.CfnOutput(this, 'GitHubOAuthClientSecretParam', { value: CLIENT_SECRET_PARAM_NAME });
    new cdk.CfnOutput(this, 'SessionTableName', { value: sessionTable.tableName });
  }
}
