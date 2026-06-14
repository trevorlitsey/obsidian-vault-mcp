import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface ObsidianVaultMcpStackProps extends cdk.StackProps {
  githubOauthClientId: string;
}

export class ObsidianVaultMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObsidianVaultMcpStackProps) {
    super(scope, id, props);

    const githubOauthClientSecret = new secretsmanager.Secret(this, 'GitHubOAuthClientSecret', {
      description: 'GitHub OAuth App client secret',
    });

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
        GITHUB_OAUTH_CLIENT_SECRET_ARN: githubOauthClientSecret.secretArn,
        TABLE_NAME: sessionTable.tableName,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
      },
    });

    githubOauthClientSecret.grantRead(handler);
    sessionTable.grantReadWriteData(handler);

    const fnUrl = handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // The Lambda needs to know its own public URL for OAuth metadata and
    // GitHub callback construction.
    handler.addEnvironment('SELF_URL', fnUrl.url);

    new cdk.CfnOutput(this, 'McpEndpoint', { value: fnUrl.url });
    new cdk.CfnOutput(this, 'GitHubCallbackUrl', { value: `${fnUrl.url}callback` });
    new cdk.CfnOutput(this, 'GitHubOAuthClientSecretArn', { value: githubOauthClientSecret.secretArn });
    new cdk.CfnOutput(this, 'SessionTableName', { value: sessionTable.tableName });
  }
}
