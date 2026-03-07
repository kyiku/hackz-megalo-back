# CDK スタック設計

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v3
> **CDK バージョン**: 2.x (TypeScript)
> **元定義**: [インフラ要件定義書](/docs/infrastructure.md), [元要件定義書](/docs/requirements.md)

---

## 1. スタック構成

バックエンドリポジトリの `cdk/lib/app-stack.ts` で全リソースを定義する。

> **注意**: OIDC + IAM Role は `hackz-megalo-infra` リポジトリで管理。
> バックエンドは自身のアプリケーションリソースのみを定義する。

```
HackzMegaloBackStack
├── Storage (S3, DynamoDB)
├── API (REST API Gateway, WebSocket API Gateway)
├── Pipeline (Step Functions Express, Lambda functions)
├── Realtime (IoT Core)
├── AI (Rekognition, Bedrock, Comprehend - IAM Policy のみ)
└── Monitoring (CloudWatch, X-Ray)
```

---

## 2. リソース詳細

### 2.1 Storage

#### S3 バケット

```typescript
// receipt-purikura-{stage}
{
  bucketName: `receipt-purikura-${stage}`,
  transferAcceleration: true,     // B-02
  cors: [{
    allowedOrigins: ['*'],        // ハッカソン向け簡易設定
    allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
    allowedHeaders: ['*'],
    maxAge: 3600,
  }],
  lifecycleRules: [
    { prefix: 'originals/', expiration: Duration.days(7) },
    { prefix: 'filtered/', expiration: Duration.days(7) },
    { prefix: 'collages/', expiration: Duration.days(30) },
    { prefix: 'print-ready/', expiration: Duration.days(7) },
    { prefix: 'downloads/', expiration: Duration.days(30) },
  ],
  removalPolicy: RemovalPolicy.DESTROY,  // ハッカソン: スタック削除時にバケットも削除
  autoDeleteObjects: true,
}
```

#### DynamoDB テーブル

```typescript
// sessions テーブル
{
  tableName: `receipt-purikura-sessions-${stage}`,
  partitionKey: { name: 'sessionId', type: AttributeType.STRING },
  sortKey: { name: 'createdAt', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
  removalPolicy: RemovalPolicy.DESTROY,
}

// connections テーブル
{
  tableName: `receipt-purikura-connections-${stage}`,
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
  removalPolicy: RemovalPolicy.DESTROY,
  // GSI: sessionId → connectionId 検索用 (進捗通知), roomId → connectionId 検索用 (シグナリング転送)
  globalSecondaryIndexes: [
    {
      indexName: 'sessionId-index',
      partitionKey: { name: 'sessionId', type: AttributeType.STRING },
    },
    {
      indexName: 'roomId-index',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
    },
  ],
}
```

### 2.2 REST API (API Gateway)

```typescript
{
  restApiName: `receipt-purikura-api-${stage}`,
  deployOptions: { stageName: stage },
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: ['Content-Type'],
  },
}
```

**ルート:**

| パス | メソッド | Lambda | 統合タイプ |
|------|---------|--------|-----------|
| `/health` | GET | - | Mock Integration |
| `/api/session` | POST | `session-create` | Lambda Proxy |
| `/api/session/{sessionId}` | GET | `session-get` | Lambda Proxy |
| `/api/session/{sessionId}/process` | POST | `process-start` | Lambda Proxy |

> `process-start` Lambda: Step Functions の `startExecution` を呼び出すだけの薄いハンドラ。

### 2.3 WebSocket API (API Gateway V2)

```typescript
{
  apiName: `receipt-purikura-ws-${stage}`,
  routeSelectionExpression: '$request.body.action',
}
```

**ルート:**

| ルートキー | Lambda |
|-----------|--------|
| `$connect` | `ws-connect` |
| `$disconnect` | `ws-disconnect` |
| `subscribe` | `ws-subscribe` |
| `join_room` | `ws-join-room` |
| `webrtc_offer` | `ws-webrtc-offer` |
| `webrtc_answer` | `ws-webrtc-answer` |
| `webrtc_ice` | `ws-webrtc-ice` |
| `shooting_sync` | `ws-shooting-sync` |

### 2.4 Lambda 関数

**共通設定:**

```typescript
const commonLambdaProps = {
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.ARM_64,
  memorySize: 10240,                   // 10GB (CPU 最大化)
  tracing: Tracing.ACTIVE,             // X-Ray トレーシング
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ['@aws-sdk/*'],   // Lambda ランタイムに含まれるため除外
  },
}
```

> `NodejsFunction` (aws-cdk-lib/aws-lambda-nodejs) を使用して esbuild でバンドル。
> `sharp` を含む Lambda は `bundling.nodeModules: ['sharp']` を指定して native addon を含める。

**関数ごとの設定:**

| 関数 | タイムアウト | 追加バンドル | 環境変数 |
|------|------------|------------|---------|
| `session-create` | 10s | - | S3_BUCKET, DYNAMODB_TABLE, WEBSOCKET_URL |
| `session-get` | 10s | - | DYNAMODB_TABLE |
| `process-start` | 10s | - | STATE_MACHINE_ARN, DYNAMODB_TABLE |
| `ws-connect` | 10s | - | CONNECTIONS_TABLE |
| `ws-disconnect` | 10s | - | CONNECTIONS_TABLE |
| `ws-subscribe` | 10s | - | CONNECTIONS_TABLE |
| `ws-join-room` | 10s | - | CONNECTIONS_TABLE |
| `ws-webrtc-offer` | 10s | - | CONNECTIONS_TABLE, WEBSOCKET_URL |
| `ws-webrtc-answer` | 10s | - | CONNECTIONS_TABLE, WEBSOCKET_URL |
| `ws-webrtc-ice` | 10s | - | CONNECTIONS_TABLE, WEBSOCKET_URL |
| `ws-shooting-sync` | 10s | - | CONNECTIONS_TABLE, WEBSOCKET_URL |
| `face-detection` | 30s | - | S3_BUCKET, DYNAMODB_TABLE |
| `filter-apply` | 60s | sharp | S3_BUCKET |
| `collage-generate` | 60s | sharp | S3_BUCKET |
| `caption-generate` | 30s | - | S3_BUCKET, DYNAMODB_TABLE |
| `print-prepare` | 60s | sharp, qrcode | S3_BUCKET |
| `yaji-comment-fast` | 10s | - | S3_BUCKET, CONNECTIONS_TABLE, WEBSOCKET_URL |
| `yaji-comment-deep` | 30s | - | S3_BUCKET, CONNECTIONS_TABLE, WEBSOCKET_URL |
| `stats-update` | 10s | - | DYNAMODB_TABLE |

共通: メモリ 10GB, ARM64 (Graviton2), Node.js 20 (TypeScript)

本番時: Provisioned Concurrency (filter-apply, collage-generate, print-prepare の3関数)

### 2.5 Step Functions

```typescript
{
  stateMachineName: `receipt-purikura-pipeline-${stage}`,
  stateMachineType: StateMachineType.EXPRESS,
  tracingEnabled: true,
  timeout: Duration.minutes(5),
}
```

> ASL (Amazon States Language) は CDK の `Chain`, `Parallel`, `LambdaInvoke` で定義する。
> 詳細は `docs/step-functions.md` 参照。

### 2.6 IoT Core

```typescript
// IoT Policy: receipt-purikura/print/{sessionId}, receipt-purikura/print/{sessionId}/status
// IoT Rule: receipt-purikura/print/+/status → Lambda → DynamoDB 更新
```

> IoT Core のデバイス証明書・Thing 登録はハッカソン向けに手動 or CLI で実施。
> CDK では IoT Policy と IoT Rule のみ定義。

### 2.7 EventBridge (将来用)

MVP では `POST /api/session/:sessionId/process` で直接 Step Functions を起動する。
将来的には S3 PutObject → EventBridge Rule → Step Functions の自動トリガーに移行可能。

---

## 3. IAM パーミッション

各 Lambda に最小権限の IAM ポリシーを付与する。

| Lambda | 必要な権限 |
|--------|----------|
| `session-create` | DynamoDB PutItem, S3 PutObject (presigned) |
| `session-get` | DynamoDB GetItem |
| `process-start` | StepFunctions StartExecution, DynamoDB UpdateItem |
| `ws-connect` | DynamoDB PutItem (connections) |
| `ws-disconnect` | DynamoDB DeleteItem (connections) |
| `ws-subscribe` | DynamoDB UpdateItem (connections) |
| `ws-join-room` | DynamoDB UpdateItem (connections) |
| `ws-webrtc-*` | DynamoDB Query (connections, roomId-index), API Gateway ManageConnections |
| `ws-shooting-sync` | DynamoDB Query (connections, roomId-index), API Gateway ManageConnections |
| `face-detection` | Rekognition DetectFaces, S3 GetObject |
| `filter-apply` | S3 GetObject/PutObject, Bedrock InvokeModel (AI フィルター時) |
| `collage-generate` | S3 GetObject/PutObject |
| `caption-generate` | Bedrock InvokeModel, Comprehend DetectSentiment, S3 GetObject, DynamoDB UpdateItem |
| `print-prepare` | S3 GetObject/PutObject |
| `yaji-comment-fast` | Rekognition DetectFaces, S3 GetObject, DynamoDB Query (connections, sessionId-index), API Gateway ManageConnections |
| `yaji-comment-deep` | Bedrock InvokeModel, S3 GetObject, DynamoDB Query (connections, sessionId-index), API Gateway ManageConnections |
| `stats-update` | DynamoDB UpdateItem |

---

## 4. 出力 (CfnOutput)

| 出力名 | 値 | 用途 |
|--------|-----|------|
| `RestApiUrl` | REST API エンドポイント URL | フロントエンド環境変数 |
| `WebSocketUrl` | WebSocket API エンドポイント URL | フロントエンド環境変数 |
| `S3BucketName` | S3 バケット名 | デバッグ用 |
| `SessionsTableName` | DynamoDB テーブル名 | デバッグ用 |

---

## 5. デプロイ

```bash
# 初回: CDK bootstrap (アカウント + リージョンに1回)
cd cdk && npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-1

# デプロイ
cd cdk && npx cdk deploy --all

# CI/CD では自動実行 (.github/workflows/ci.yml の deploy ジョブ)
```
