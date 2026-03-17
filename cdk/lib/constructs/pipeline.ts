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
  readonly pipelineCompleteFn: IFunction
}


export class Pipeline extends Construct {
  public readonly stateMachine: StateMachine

  constructor(scope: Construct, id: string, props: PipelineProps) {
    super(scope, id)

    const { stage } = props

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

    // Merge Phase 1: take filter-apply output (index 1) which has filteredImages
    const mergePhase1 = new Pass(this, 'MergePhase1', {
      comment: 'Take filter-apply output with filteredImages',
      inputPath: '$[1]',
    })

    // -------------------------------------------------------
    // Phase 2: collage-generate (sequential, needs filteredImages)
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

    // -------------------------------------------------------
    // Phase 3: caption-generate (sequential, optional)
    // Runs before print-prepare so caption can be included in layout
    // -------------------------------------------------------
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
      }),
      { resultPath: '$.captionGenerateError' },
    )

    // -------------------------------------------------------
    // Phase 4: print-prepare (receives caption from Phase 3)
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
    // Phase 4: pipeline-complete
    // -------------------------------------------------------
    const pipelineCompleteStep = new LambdaInvoke(this, 'PipelineComplete', {
      lambdaFunction: props.pipelineCompleteFn,
      outputPath: '$.Payload',
    })
    pipelineCompleteStep.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 2.0,
    })

    // -------------------------------------------------------
    // Chain all phases
    // Phase1(face+filter) → collage → caption → print → complete
    // -------------------------------------------------------
    const workflow = Chain.start(phase1)
      .next(mergePhase1)
      .next(collageGenerateStep)
      .next(captionGenerateStep)
      .next(printPrepareStep)
      .next(pipelineCompleteStep)

    this.stateMachine = new StateMachine(this, 'StateMachine', {
      stateMachineName: `receipt-purikura-pipeline-${stage}`,
      stateMachineType: StateMachineType.EXPRESS,
      tracingEnabled: true,
      timeout: Duration.minutes(5),
      definitionBody: DefinitionBody.fromChainable(workflow),
    })
  }
}
