import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'

export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const githubOidcProvider = new iam.OpenIdConnectProvider(
      this,
      'GithubOidcProvider',
      {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
        thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
      },
    )

    const deployRole = new iam.Role(this, 'GithubActionsDeployRole', {
      roleName: 'hackz-megalo-back-github-actions',
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub':
              'repo:kyiku/hackz-megalo-back:ref:refs/heads/main',
          },
        },
      ),
      // NOTE: AdministratorAccess is intentional for initial CDK bootstrap.
      // TODO: Scope down to least-privilege before production use.
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
      maxSessionDuration: cdk.Duration.hours(1),
    })

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description:
        'IAM Role ARN for GitHub Actions. Set this as AWS_ROLE_ARN in GitHub Secrets.',
    })
  }
}
