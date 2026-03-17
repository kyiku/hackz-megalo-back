import { Construct } from 'constructs'
import { Duration } from 'aws-cdk-lib'
import {
  Cors,
  LambdaIntegration,
  MockIntegration,
  PassthroughBehavior,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway'
import {
  Alias,
  Architecture,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda'
import type { IFunction } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import {
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2'
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { join } from 'node:path'

import type { Storage } from './storage'

export interface ApiProps {
  readonly storage: Storage
  readonly stage: string
}

interface LambdaConfig {
  readonly name: string
  readonly timeout: Duration
  readonly environment: Record<string, string>
  readonly nodeModules?: readonly string[]
}

const FUNCTIONS_DIR = join(__dirname, '../../../src/functions')

function createCommonProps(config: LambdaConfig) {
  return {
    runtime: Runtime.NODEJS_20_X,
    architecture: Architecture.ARM_64,
    memorySize: 3008,
    tracing: Tracing.ACTIVE,
    timeout: config.timeout,
    handler: 'handler',
    entry: join(FUNCTIONS_DIR, config.name, 'handler.ts'),
    environment: config.environment,
    depsLockFilePath: join(__dirname, '../../../package-lock.json'),
    bundling: {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
      ...(config.nodeModules
        ? {
            nodeModules: [...config.nodeModules],
            // Force Docker bundling so native addons (e.g. sharp) are compiled
            // for linux-arm64 (Lambda Graviton2) instead of the host macOS arch.
            forceDockerBundling: true,
          }
        : {}),
    },
  }
}

export class Api extends Construct {
  public readonly restApi: RestApi
  public readonly webSocketApi: WebSocketApi
  public readonly webSocketStage: WebSocketStage

  // REST Lambda functions
  public readonly sessionCreateFn: NodejsFunction
  public readonly sessionGetFn: NodejsFunction
  public readonly processStartFn: NodejsFunction

  // WebSocket Lambda functions
  public readonly wsConnectFn: NodejsFunction
  public readonly wsDisconnectFn: NodejsFunction
  public readonly wsSubscribeFn: NodejsFunction
  public readonly wsJoinRoomFn: NodejsFunction
  public readonly wsWebrtcOfferFn: NodejsFunction
  public readonly wsWebrtcAnswerFn: NodejsFunction
  public readonly wsWebrtcIceFn: NodejsFunction
  public readonly wsShootingSyncFn: NodejsFunction

  // Pipeline Lambda functions
  public readonly faceDetectionFn: NodejsFunction
  public readonly filterApplyFn: NodejsFunction
  public readonly collageGenerateFn: NodejsFunction
  public readonly captionGenerateFn: NodejsFunction
  public readonly printPrepareFn: NodejsFunction

  // Pipeline invocation targets (alias with Provisioned Concurrency in prod)
  public readonly filterApplyTarget: IFunction
  public readonly collageGenerateTarget: IFunction
  public readonly printPrepareTarget: IFunction

  // Yaji comment Lambda functions
  public readonly yajiCommentFastFn: NodejsFunction
  public readonly yajiCommentDeepFn: NodejsFunction

  // Pipeline complete Lambda function
  public readonly pipelineCompleteFn: NodejsFunction

  // Pipeline error Lambda function
  public readonly pipelineErrorFn: NodejsFunction

  // Stats Lambda function
  public readonly statsUpdateFn: NodejsFunction

  // Countdown audio Lambda function
  public readonly countdownAudioFn: NodejsFunction

  // Voice command Lambda function
  public readonly voiceCommandFn: NodejsFunction

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id)

    const { storage, stage } = props
    const bucketName = storage.bucket.bucketName
    const sessionsTableName = storage.sessionsTable.tableName
    const connectionsTableName = storage.connectionsTable.tableName

    // -------------------------------------------------------
    // WebSocket API (create first to get URL for env vars)
    // -------------------------------------------------------
    this.webSocketApi = new WebSocketApi(this, 'WebSocketApi', {
      apiName: `receipt-purikura-ws-${stage}`,
      routeSelectionExpression: '$request.body.action',
    })

    this.webSocketStage = new WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: stage,
      autoDeploy: true,
    })

    const websocketUrl = this.webSocketStage.url

    // -------------------------------------------------------
    // REST API Lambda functions
    // -------------------------------------------------------
    this.sessionCreateFn = new NodejsFunction(this, 'SessionCreateFn', createCommonProps({
      name: 'session-create',
      timeout: Duration.seconds(10),
      environment: {
        S3_BUCKET: bucketName,
        DYNAMODB_TABLE: sessionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.sessionGetFn = new NodejsFunction(this, 'SessionGetFn', createCommonProps({
      name: 'session-get',
      timeout: Duration.seconds(10),
      environment: {
        DYNAMODB_TABLE: sessionsTableName,
        S3_BUCKET: bucketName,
      },
    }))

    this.processStartFn = new NodejsFunction(this, 'ProcessStartFn', createCommonProps({
      name: 'process-start',
      timeout: Duration.seconds(10),
      environment: {
        STATE_MACHINE_ARN: '', // Set later by pipeline construct
        DYNAMODB_TABLE: sessionsTableName,
        S3_BUCKET: bucketName,
      },
    }))

    // -------------------------------------------------------
    // WebSocket Lambda functions
    // -------------------------------------------------------
    this.wsConnectFn = new NodejsFunction(this, 'WsConnectFn', createCommonProps({
      name: 'ws-connect',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
      },
    }))

    this.wsDisconnectFn = new NodejsFunction(this, 'WsDisconnectFn', createCommonProps({
      name: 'ws-disconnect',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
      },
    }))

    this.wsSubscribeFn = new NodejsFunction(this, 'WsSubscribeFn', createCommonProps({
      name: 'ws-subscribe',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
      },
    }))

    this.wsJoinRoomFn = new NodejsFunction(this, 'WsJoinRoomFn', createCommonProps({
      name: 'ws-join-room',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
      },
    }))

    this.wsWebrtcOfferFn = new NodejsFunction(this, 'WsWebrtcOfferFn', createCommonProps({
      name: 'ws-webrtc-offer',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.wsWebrtcAnswerFn = new NodejsFunction(this, 'WsWebrtcAnswerFn', createCommonProps({
      name: 'ws-webrtc-answer',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.wsWebrtcIceFn = new NodejsFunction(this, 'WsWebrtcIceFn', createCommonProps({
      name: 'ws-webrtc-ice',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.wsShootingSyncFn = new NodejsFunction(this, 'WsShootingSyncFn', createCommonProps({
      name: 'ws-shooting-sync',
      timeout: Duration.seconds(10),
      environment: {
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    // -------------------------------------------------------
    // Pipeline Lambda functions
    // -------------------------------------------------------
    this.faceDetectionFn = new NodejsFunction(this, 'FaceDetectionFn', createCommonProps({
      name: 'face-detection',
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET: bucketName,
        DYNAMODB_TABLE: sessionsTableName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.filterApplyFn = new NodejsFunction(this, 'FilterApplyFn', createCommonProps({
      name: 'filter-apply',
      timeout: Duration.seconds(60),
      nodeModules: ['sharp'],
      environment: {
        S3_BUCKET: bucketName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.collageGenerateFn = new NodejsFunction(this, 'CollageGenerateFn', createCommonProps({
      name: 'collage-generate',
      timeout: Duration.seconds(60),
      nodeModules: ['sharp'],
      environment: {
        S3_BUCKET: bucketName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.captionGenerateFn = new NodejsFunction(this, 'CaptionGenerateFn', createCommonProps({
      name: 'caption-generate',
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET: bucketName,
        DYNAMODB_TABLE: sessionsTableName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.printPrepareFn = new NodejsFunction(this, 'PrintPrepareFn', createCommonProps({
      name: 'print-prepare',
      timeout: Duration.seconds(60),
      nodeModules: ['sharp', 'qrcode'],
      environment: {
        S3_BUCKET: bucketName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.pipelineCompleteFn = new NodejsFunction(this, 'PipelineCompleteFn', createCommonProps({
      name: 'pipeline-complete',
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET: bucketName,
        DYNAMODB_TABLE: sessionsTableName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.pipelineErrorFn = new NodejsFunction(this, 'PipelineErrorFn', createCommonProps({
      name: 'pipeline-error',
      timeout: Duration.seconds(10),
      environment: {
        DYNAMODB_TABLE: sessionsTableName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    // -------------------------------------------------------
    // Yaji comment Lambda functions
    // -------------------------------------------------------
    this.yajiCommentFastFn = new NodejsFunction(this, 'YajiCommentFastFn', createCommonProps({
      name: 'yaji-comment-fast',
      timeout: Duration.seconds(10),
      environment: {
        S3_BUCKET: bucketName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    this.yajiCommentDeepFn = new NodejsFunction(this, 'YajiCommentDeepFn', createCommonProps({
      name: 'yaji-comment-deep',
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET: bucketName,
        CONNECTIONS_TABLE: connectionsTableName,
        WEBSOCKET_URL: websocketUrl,
      },
    }))

    // -------------------------------------------------------
    // Stats Lambda function
    // -------------------------------------------------------
    this.statsUpdateFn = new NodejsFunction(this, 'StatsUpdateFn', createCommonProps({
      name: 'stats-update',
      timeout: Duration.seconds(10),
      environment: {
        DYNAMODB_TABLE: sessionsTableName,
      },
    }))

    // -------------------------------------------------------
    // Countdown audio Lambda function (Polly)
    // -------------------------------------------------------
    this.countdownAudioFn = new NodejsFunction(this, 'CountdownAudioFn', createCommonProps({
      name: 'countdown-audio',
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET: bucketName,
      },
    }))

    // -------------------------------------------------------
    // Voice command Lambda function (Transcribe)
    // -------------------------------------------------------
    this.voiceCommandFn = new NodejsFunction(this, 'VoiceCommandFn', createCommonProps({
      name: 'voice-command',
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET: bucketName,
      },
    }))

    // -------------------------------------------------------
    // Invocation targets (Provisioned Concurrency disabled:
    // account concurrent execution quota too low.
    // Enable after Service Quotas increase request)
    // -------------------------------------------------------
    this.filterApplyTarget = this.filterApplyFn
    this.collageGenerateTarget = this.collageGenerateFn
    this.printPrepareTarget = this.printPrepareFn

    // -------------------------------------------------------
    // WebSocket route integrations
    // -------------------------------------------------------
    this.webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('ConnectIntegration', this.wsConnectFn),
    })
    this.webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('DisconnectIntegration', this.wsDisconnectFn),
    })
    this.webSocketApi.addRoute('subscribe', {
      integration: new WebSocketLambdaIntegration('SubscribeIntegration', this.wsSubscribeFn),
    })
    this.webSocketApi.addRoute('join_room', {
      integration: new WebSocketLambdaIntegration('JoinRoomIntegration', this.wsJoinRoomFn),
    })
    this.webSocketApi.addRoute('webrtc_offer', {
      integration: new WebSocketLambdaIntegration('WebrtcOfferIntegration', this.wsWebrtcOfferFn),
    })
    this.webSocketApi.addRoute('webrtc_answer', {
      integration: new WebSocketLambdaIntegration('WebrtcAnswerIntegration', this.wsWebrtcAnswerFn),
    })
    this.webSocketApi.addRoute('webrtc_ice', {
      integration: new WebSocketLambdaIntegration('WebrtcIceIntegration', this.wsWebrtcIceFn),
    })
    this.webSocketApi.addRoute('shooting_sync', {
      integration: new WebSocketLambdaIntegration('ShootingSyncIntegration', this.wsShootingSyncFn),
    })

    // -------------------------------------------------------
    // REST API Gateway
    // -------------------------------------------------------
    this.restApi = new RestApi(this, 'RestApi', {
      restApiName: `receipt-purikura-api-${stage}`,
      deployOptions: { stageName: stage },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ['Content-Type'],
      },
    })

    // GET /health - Mock Integration with timestamp
    const healthResource = this.restApi.root.addResource('health')
    healthResource.addMethod('GET', new MockIntegration({
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'application/json': '{"status":"ok","timestamp":"$context.requestTime"}',
          },
        },
      ],
      passthroughBehavior: PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    }), {
      methodResponses: [{ statusCode: '200' }],
    })

    // POST /api/session
    const apiResource = this.restApi.root.addResource('api')
    const sessionResource = apiResource.addResource('session')
    sessionResource.addMethod('POST', new LambdaIntegration(this.sessionCreateFn))

    // GET /api/session/{sessionId}
    const sessionIdResource = sessionResource.addResource('{sessionId}')
    sessionIdResource.addMethod('GET', new LambdaIntegration(this.sessionGetFn))

    // POST /api/session/{sessionId}/process
    const processResource = sessionIdResource.addResource('process')
    processResource.addMethod('POST', new LambdaIntegration(this.processStartFn))
  }
}
