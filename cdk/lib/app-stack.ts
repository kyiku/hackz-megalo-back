import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'

import { Storage } from './constructs/storage'
import { Api } from './constructs/api'
import { Pipeline } from './constructs/pipeline'
import { Realtime } from './constructs/realtime'

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const stage = this.node.tryGetContext('stage') ?? 'dev'

    // -------------------------------------------------------
    // Constructs
    // -------------------------------------------------------
    const storage = new Storage(this, 'Storage', { stage })

    const api = new Api(this, 'Api', { storage, stage })

    const pipeline = new Pipeline(this, 'Pipeline', {
      stage,
      faceDetectionFn: api.faceDetectionFn,
      filterApplyFn: api.filterApplyFn,
      collageGenerateFn: api.collageGenerateFn,
      captionGenerateFn: api.captionGenerateFn,
      printPrepareFn: api.printPrepareFn,
    })

    const realtime = new Realtime(this, 'Realtime', { stage })

    // Set STATE_MACHINE_ARN on process-start after pipeline is created
    api.processStartFn.addEnvironment(
      'STATE_MACHINE_ARN',
      pipeline.stateMachine.stateMachineArn,
    )

    // WebSocket Management API ARN for execute-api permissions
    const webSocketApiArn = cdk.Fn.sub(
      'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ApiId}/${Stage}/*',
      {
        ApiId: api.webSocketApi.apiId,
        Stage: stage,
      },
    )

    // -------------------------------------------------------
    // IAM Permissions
    // -------------------------------------------------------

    // session-create: DynamoDB PutItem on sessions, S3 read/write
    storage.sessionsTable.grantWriteData(api.sessionCreateFn)
    storage.bucket.grantReadWrite(api.sessionCreateFn)

    // session-get: DynamoDB GetItem on sessions, S3 GetObject for presigned URLs
    storage.sessionsTable.grantReadData(api.sessionGetFn)
    storage.bucket.grantRead(api.sessionGetFn)

    // process-start: Step Functions StartExecution, DynamoDB UpdateItem
    pipeline.stateMachine.grantStartExecution(api.processStartFn)
    storage.sessionsTable.grantWriteData(api.processStartFn)

    // ws-connect: DynamoDB write on connections
    storage.connectionsTable.grantWriteData(api.wsConnectFn)

    // ws-disconnect: DynamoDB write on connections
    storage.connectionsTable.grantWriteData(api.wsDisconnectFn)

    // ws-subscribe: DynamoDB UpdateItem on connections
    storage.connectionsTable.grantWriteData(api.wsSubscribeFn)

    // ws-join-room: DynamoDB UpdateItem on connections
    storage.connectionsTable.grantWriteData(api.wsJoinRoomFn)

    // ws-webrtc-offer: DynamoDB Query on connections (roomId-index), ManageConnections
    storage.connectionsTable.grantReadData(api.wsWebrtcOfferFn)
    api.wsWebrtcOfferFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [webSocketApiArn],
    }))

    // ws-webrtc-answer: DynamoDB Query on connections (roomId-index), ManageConnections
    storage.connectionsTable.grantReadData(api.wsWebrtcAnswerFn)
    api.wsWebrtcAnswerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [webSocketApiArn],
    }))

    // ws-webrtc-ice: DynamoDB Query on connections (roomId-index), ManageConnections
    storage.connectionsTable.grantReadData(api.wsWebrtcIceFn)
    api.wsWebrtcIceFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [webSocketApiArn],
    }))

    // ws-shooting-sync: DynamoDB Query on connections (roomId-index), ManageConnections
    storage.connectionsTable.grantReadData(api.wsShootingSyncFn)
    api.wsShootingSyncFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [webSocketApiArn],
    }))

    // face-detection: S3 GetObject, Rekognition
    storage.bucket.grantRead(api.faceDetectionFn)
    api.faceDetectionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectFaces'],
      resources: ['*'],
    }))

    // filter-apply: S3 read/write, Bedrock
    storage.bucket.grantReadWrite(api.filterApplyFn)
    api.filterApplyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }))

    // collage-generate: S3 read/write
    storage.bucket.grantReadWrite(api.collageGenerateFn)

    // caption-generate: S3 GetObject, DynamoDB UpdateItem, Bedrock + Comprehend
    storage.bucket.grantRead(api.captionGenerateFn)
    storage.sessionsTable.grantWriteData(api.captionGenerateFn)
    api.captionGenerateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }))
    api.captionGenerateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['comprehend:DetectSentiment'],
      resources: ['*'],
    }))

    // print-prepare: S3 read/write
    storage.bucket.grantReadWrite(api.printPrepareFn)

    // yaji-comment-fast: S3 GetObject, DynamoDB Query connections, ManageConnections, Rekognition
    storage.bucket.grantRead(api.yajiCommentFastFn)
    storage.connectionsTable.grantReadData(api.yajiCommentFastFn)
    api.yajiCommentFastFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [webSocketApiArn],
    }))
    api.yajiCommentFastFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectFaces'],
      resources: ['*'],
    }))

    // yaji-comment-deep: S3 GetObject, DynamoDB Query connections, ManageConnections, Bedrock
    storage.bucket.grantRead(api.yajiCommentDeepFn)
    storage.connectionsTable.grantReadData(api.yajiCommentDeepFn)
    api.yajiCommentDeepFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [webSocketApiArn],
    }))
    api.yajiCommentDeepFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }))

    // stats-update: DynamoDB UpdateItem on sessions
    storage.sessionsTable.grantWriteData(api.statsUpdateFn)

    // -------------------------------------------------------
    // CfnOutputs
    // -------------------------------------------------------
    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: api.restApi.url,
    })

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: api.webSocketStage.url,
    })

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: storage.bucket.bucketName,
    })

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: storage.sessionsTable.tableName,
    })
  }
}
