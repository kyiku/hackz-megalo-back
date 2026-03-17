import { Construct } from 'constructs'
import { Duration } from 'aws-cdk-lib'
import {
  Dashboard,
  GraphWidget,
  Metric,
  TextWidget,
} from 'aws-cdk-lib/aws-cloudwatch'
import type { IFunction } from 'aws-cdk-lib/aws-lambda'
import type { StateMachine } from 'aws-cdk-lib/aws-stepfunctions'
import type { RestApi } from 'aws-cdk-lib/aws-apigateway'

export interface MonitoringProps {
  readonly stage: string
  readonly restApi: RestApi
  readonly stateMachine: StateMachine
  readonly lambdaFunctions: Record<string, IFunction>
}

export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id)

    const { stage, restApi, stateMachine, lambdaFunctions } = props

    // -------------------------------------------------------
    // CloudWatch Dashboard
    // -------------------------------------------------------
    const dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `receipt-purikura-${stage}`,
    })

    // Header
    dashboard.addWidgets(
      new TextWidget({
        markdown: `# Receipt Purikura - ${stage}\nリアルタイムモニタリングダッシュボード`,
        width: 24,
        height: 1,
      }),
    )

    // API Gateway metrics
    dashboard.addWidgets(
      new GraphWidget({
        title: 'API Gateway - リクエスト数',
        left: [
          new Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiName: restApi.restApiName },
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new GraphWidget({
        title: 'API Gateway - レイテンシ',
        left: [
          new Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: restApi.restApiName },
            statistic: 'Average',
            period: Duration.minutes(1),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new GraphWidget({
        title: 'API Gateway - エラー率',
        left: [
          new Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4XXError',
            dimensionsMap: { ApiName: restApi.restApiName },
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
          new Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: { ApiName: restApi.restApiName },
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
        ],
        width: 8,
        height: 6,
      }),
    )

    // Step Functions metrics
    dashboard.addWidgets(
      new GraphWidget({
        title: 'Step Functions - 実行数',
        left: [
          stateMachine.metricStarted({ period: Duration.minutes(1) }),
          stateMachine.metricSucceeded({ period: Duration.minutes(1) }),
          stateMachine.metricFailed({ period: Duration.minutes(1) }),
        ],
        width: 12,
        height: 6,
      }),
      new GraphWidget({
        title: 'Step Functions - 実行時間',
        left: [
          stateMachine.metricTime({ period: Duration.minutes(1) }),
        ],
        width: 12,
        height: 6,
      }),
    )

    // Lambda metrics (key functions)
    const keyFunctions = [
      'session-create', 'filter-apply', 'collage-generate',
      'print-prepare', 'pipeline-complete',
    ]

    const lambdaDurationMetrics = keyFunctions
      .filter((name) => lambdaFunctions[name])
      .map((name) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fn = lambdaFunctions[name]!
        return fn.metricDuration({ period: Duration.minutes(1), label: name })
      })

    const lambdaErrorMetrics = keyFunctions
      .filter((name) => lambdaFunctions[name])
      .map((name) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fn = lambdaFunctions[name]!
        return fn.metricErrors({ period: Duration.minutes(1), label: name })
      })

    dashboard.addWidgets(
      new GraphWidget({
        title: 'Lambda - 実行時間 (主要関数)',
        left: lambdaDurationMetrics,
        width: 12,
        height: 6,
      }),
      new GraphWidget({
        title: 'Lambda - エラー数 (主要関数)',
        left: lambdaErrorMetrics,
        width: 12,
        height: 6,
      }),
    )
  }
}
