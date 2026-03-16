import { Construct } from 'constructs'
import { Duration } from 'aws-cdk-lib'
import {
  Chain,
  DefinitionBody,
  Parallel,
  Pass,
  StateMachine,
  StateMachineType,
} from 'aws-cdk-lib/aws-stepfunctions'
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks'
import type { IFunction } from 'aws-cdk-lib/aws-lambda'

export interface PipelineProps {
  readonly stage: string
  readonly faceDetectionFn: IFunction
  readonly filterApplyFn: IFunction
  readonly collageGenerateFn: IFunction
  readonly captionGenerateFn: IFunction
  readonly printPrepareFn: IFunction
}


export class Pipeline extends Construct {
  public readonly stateMachine: StateMachine

  constructor(scope: Construct, id: string, props: PipelineProps) {
    super(scope, id)

    const { stage } = props

    // -------------------------------------------------------
    // Update Session: set status to "processing"
    // -------------------------------------------------------
    const updateSession = new Pass(this, 'UpdateSession', {
      comment: 'Set session status to processing',
      result: { value: 'processing' },
      resultPath: '$.processingStatus',
    })

    // -------------------------------------------------------
    // Phase 1: Parallel(face-detection, filter-apply)
    // -------------------------------------------------------
    const faceDetectionStep = new LambdaInvoke(this, 'FaceDetection', {
      lambdaFunction: props.faceDetectionFn,
      outputPath: '$.Payload',
    })
    faceDetectionStep.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 2.0,
    })
    // face-detection is optional: catch errors and continue
    faceDetectionStep.addCatch(
      new Pass(this, 'FaceDetectionFallback', {
        comment: 'Face detection failed, continue without face data',
        result: { value: { faces: [] } },
        resultPath: '$.Payload',
      }),
      { resultPath: '$.faceDetectionError' },
    )

    const filterApplyStep = new LambdaInvoke(this, 'FilterApply', {
      lambdaFunction: props.filterApplyFn,
      outputPath: '$.Payload',
    })
    filterApplyStep.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 2.0,
    })

    const phase1 = new Parallel(this, 'Phase1-FaceAndFilter')
      .branch(faceDetectionStep)
      .branch(filterApplyStep)

    // -------------------------------------------------------
    // Phase 2: Parallel(collage-generate, caption-generate)
    // -------------------------------------------------------
    const collageGenerateStep = new LambdaInvoke(this, 'CollageGenerate', {
      lambdaFunction: props.collageGenerateFn,
      outputPath: '$.Payload',
    })
    collageGenerateStep.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 2.0,
    })

    const captionGenerateStep = new LambdaInvoke(this, 'CaptionGenerate', {
      lambdaFunction: props.captionGenerateFn,
      outputPath: '$.Payload',
    })
    captionGenerateStep.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 2.0,
    })
    // caption-generate is optional: catch errors and continue
    captionGenerateStep.addCatch(
      new Pass(this, 'CaptionGenerateFallback', {
        comment: 'Caption generation failed, continue without caption',
        result: { value: { caption: '', sentiment: 'NEUTRAL', sentimentScore: 0.5 } },
        resultPath: '$.Payload',
      }),
      { resultPath: '$.captionGenerateError' },
    )

    const phase2 = new Parallel(this, 'Phase2-CollageAndCaption')
      .branch(collageGenerateStep)
      .branch(captionGenerateStep)

    // -------------------------------------------------------
    // Phase 3: print-prepare
    // -------------------------------------------------------
    const printPrepareStep = new LambdaInvoke(this, 'PrintPrepare', {
      lambdaFunction: props.printPrepareFn,
      outputPath: '$.Payload',
    })
    printPrepareStep.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 2.0,
    })

    // -------------------------------------------------------
    // Phase 4: Parallel outputs
    // (Simplified as Pass states for now)
    // -------------------------------------------------------
    const dynamoUpdateStep = new Pass(this, 'DynamoUpdate', {
      comment: 'Update DynamoDB session status to completed',
    })

    const iotPublishStep = new Pass(this, 'IoTPublish', {
      comment: 'Publish print job via IoT Core MQTT',
    })

    const websocketNotifyStep = new Pass(this, 'WebSocketNotify', {
      comment: 'Send completed notification via WebSocket',
    })

    const phase4 = new Parallel(this, 'Phase4-Outputs')
      .branch(dynamoUpdateStep)
      .branch(iotPublishStep)
      .branch(websocketNotifyStep)

    // -------------------------------------------------------
    // Chain all phases
    // -------------------------------------------------------
    const workflow = Chain.start(updateSession)
      .next(phase1)
      .next(phase2)
      .next(printPrepareStep)
      .next(phase4)

    this.stateMachine = new StateMachine(this, 'StateMachine', {
      stateMachineName: `receipt-purikura-pipeline-${stage}`,
      stateMachineType: StateMachineType.EXPRESS,
      tracingEnabled: true,
      timeout: Duration.minutes(5),
      definitionBody: DefinitionBody.fromChainable(workflow),
    })
  }
}
