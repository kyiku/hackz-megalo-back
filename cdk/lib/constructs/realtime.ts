import { Construct } from 'constructs'
import { CfnPolicy } from 'aws-cdk-lib/aws-iot'
import * as sns from 'aws-cdk-lib/aws-sns'

export interface RealtimeProps {
  readonly stage: string
}

export class Realtime extends Construct {
  public readonly iotPolicyName: string
  public readonly printCompleteTopic: sns.Topic
  public readonly alarmTopic: sns.Topic

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

    // SNS: Print completion fan-out
    this.printCompleteTopic = new sns.Topic(this, 'PrintCompleteTopic', {
      topicName: `receipt-purikura-print-complete-${stage}`,
      displayName: 'Receipt Purikura Print Complete',
    })

    // SNS: Alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `receipt-purikura-alarms-${stage}`,
      displayName: 'Receipt Purikura Alarms',
    })
  }
}
