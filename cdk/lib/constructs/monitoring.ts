import { Construct } from 'constructs'
import {
  Duration,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib'
import * as synthetics from 'aws-cdk-lib/aws-synthetics'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { ITopic } from 'aws-cdk-lib/aws-sns'
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import type { StateMachine } from 'aws-cdk-lib/aws-stepfunctions'

export interface MonitoringProps {
  readonly stage: string
  readonly healthUrl: string
  readonly alarmTopic: ITopic
  readonly stateMachine: StateMachine
}

export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id)

    const { stage, healthUrl, alarmTopic, stateMachine } = props

    // -------------------------------------------------------
    // CloudWatch Synthetics - Health Check Canary
    // -------------------------------------------------------
    const artifactBucket = new s3.Bucket(this, 'CanaryArtifacts', {
      bucketName: `receipt-purikura-canary-${stage}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { expiration: Duration.days(7) },
      ],
    })

    const canaryRole = new iam.Role(this, 'CanaryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'),
      ],
    })

    artifactBucket.grantReadWrite(canaryRole)

    new synthetics.CfnCanary(this, 'HealthCanary', {
      name: `rp-health-${stage}`,
      executionRoleArn: canaryRole.roleArn,
      artifactS3Location: `s3://${artifactBucket.bucketName}/`,
      runtimeVersion: 'syn-nodejs-puppeteer-9.1',
      schedule: {
        expression: 'rate(5 minutes)',
      },
      code: {
        handler: 'index.handler',
        script: [
          "const https = require('https');",
          "const url = require('url');",
          '',
          'exports.handler = async () => {',
          `  const endpoint = '${healthUrl}health';`,
          '  const parsed = url.parse(endpoint);',
          '  return new Promise((resolve, reject) => {',
          '    https.get(parsed, (res) => {',
          '      if (res.statusCode === 200) {',
          "        resolve('Health check passed');",
          '      } else {',
          "        reject(new Error('Status: ' + res.statusCode));",
          '      }',
          '    }).on(\'error\', reject);',
          '  });',
          '};',
        ].join('\n'),
      },
      startCanaryAfterCreation: true,
    })

    // -------------------------------------------------------
    // CloudWatch Alarms
    // -------------------------------------------------------

    // Lambda error rate > 5%
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: `receipt-purikura-lambda-errors-${stage}`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    })
    lambdaErrorAlarm.addAlarmAction(new actions.SnsAction(alarmTopic))

    // Step Functions failures
    const sfnFailAlarm = new cloudwatch.Alarm(this, 'StepFunctionsFailAlarm', {
      alarmName: `receipt-purikura-sfn-failures-${stage}`,
      metric: stateMachine.metricFailed({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
    sfnFailAlarm.addAlarmAction(new actions.SnsAction(alarmTopic))

    // -------------------------------------------------------
    // CloudWatch Dashboard
    // -------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `receipt-purikura-${stage}`,
    })

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Step Functions',
        left: [
          stateMachine.metricSucceeded({ period: Duration.minutes(1) }),
          stateMachine.metricFailed({ period: Duration.minutes(1) }),
        ],
        width: 12,
      }),
    )
  }
}
