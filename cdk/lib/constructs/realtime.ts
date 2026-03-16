import { Construct } from 'constructs'
import { CfnPolicy } from 'aws-cdk-lib/aws-iot'

export interface RealtimeProps {
  readonly stage: string
}

export class Realtime extends Construct {
  public readonly iotPolicyName: string

  constructor(scope: Construct, id: string, props: RealtimeProps) {
    super(scope, id)

    const { stage } = props
    const policyName = `receipt-purikura-iot-policy-${stage}`

    new CfnPolicy(this, 'IoTPolicy', {
      policyName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'iot:Connect',
              'iot:Publish',
              'iot:Subscribe',
              'iot:Receive',
            ],
            Resource: [
              `arn:aws:iot:*:*:topic/receipt-purikura/print/*`,
              `arn:aws:iot:*:*:topicfilter/receipt-purikura/print/*`,
              `arn:aws:iot:*:*:topic/receipt-purikura/print/*/status`,
              `arn:aws:iot:*:*:topicfilter/receipt-purikura/print/*/status`,
              'arn:aws:iot:*:*:client/*',
            ],
          },
        ],
      },
    })

    this.iotPolicyName = policyName
  }
}
