import { Construct } from 'constructs'
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2'
import type { RestApi } from 'aws-cdk-lib/aws-apigateway'

export interface WafProps {
  readonly stage: string
  readonly restApi: RestApi
}

export class Waf extends Construct {
  public readonly webAcl: CfnWebACL

  constructor(scope: Construct, id: string, props: WafProps) {
    super(scope, id)

    const { stage, restApi } = props

    this.webAcl = new CfnWebACL(this, 'WebACL', {
      name: `receipt-purikura-waf-${stage}`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 500,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `ReceiptPurikuraWAF-${stage}`,
      },
    })

    new CfnWebACLAssociation(this, 'WebACLAssociation', {
      webAclArn: this.webAcl.attrArn,
      resourceArn: restApi.deploymentStage.stageArn,
    })
  }
}
