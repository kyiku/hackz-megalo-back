# CDK スタック設計

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v1
> **CDK バージョン**: 2.x (TypeScript)

---

## 1. スタック構成

バックエンドリポジトリの `cdk/lib/app-stack.ts` で全リソースを定義する。

> **注意**: OIDC + IAM Role は `hackz-megalo-infra` リポジトリで管理。
> バックエンドは自身のアプリケーションリソースのみを定義する。

```
HackzMegaloBackStack
├── Storage (S3, DynamoDB)
├── API (REST API Gateway, WebSocket API Gateway)
├── Pipeline (Step Functions, Lambda functions)
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
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
  removalPolicy: RemovalPolicy.DESTROY,
  // GSI: roomId → sessionId 検索用
  globalSecondaryIndexes: [{
    indexName: 'roomId-index',
    partitionKey: { name: 'roomId', type: AttributeType.STRING },
  }],
}

// connections テーブル
{
  tableName: `receipt-purikura-connections-${stage}`,
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
  removalPolicy: RemovalPolicy.DESTROY,
  // GSI: sessionId → connectionId 検索用 (進捗通知で使用)
  globalSecondaryIndexes: [{
    indexName: 'sessionId-index',
    partitionKey: { name: 'sessionId', type: AttributeType.STRING },
  }],
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
| `/sessions` | POST | `session-create` | Lambda Proxy |
| `/sessions/{id}` | GET | `session-get` | Lambda Proxy |
| `/sessions/{id}/upload-url` | POST | `upload-url` | Lambda Proxy |
| `/sessions/{id}/process` | POST | `process-start` | Lambda Proxy |
| `/sessions/{id}/download-url` | GET | `download-url` | Lambda Proxy |

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
| `joinRoom` | `ws-join-room` |
| `signal` | `ws-signal` |

### 2.4 Lambda 関数

**共通設定:**

```typescript
const commonLambdaProps = {
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.ARM_64,
  tracing: Tracing.ACTIVE,         // X-Ray トレーシング
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ['@aws-sdk/*'],  // Lambda ランタイムに含まれるため除外
  },
}
```

> `NodejsFunction` (aws-cdk-lib/aws-lambda-nodejs) を使用して esbuild でバンドル。
> `sharp` を含む Lambda は `bundling.nodeModules: ['sharp']` を指定して native addon を含める。

**関数ごとの設定:**

| 関数 | メモリ | タイムアウト | 追加バンドル | 環境変数 |
|------|--------|------------|------------|---------|
| `session-create` | 256MB | 10s | - | S3_BUCKET, SESSIONS_TABLE |
| `session-get` | 256MB | 10s | - | SESSIONS_TABLE |
| `upload-url` | 256MB | 10s | - | S3_BUCKET |
| `process-start` | 256MB | 10s | - | STATE_MACHINE_ARN, SESSIONS_TABLE |
| `download-url` | 256MB | 10s | - | S3_BUCKET, CLOUDFRONT_DOMAIN |
| `ws-connect` | 256MB | 10s | - | CONNECTIONS_TABLE |
| `ws-disconnect` | 256MB | 10s | - | CONNECTIONS_TABLE |
| `ws-join-room` | 256MB | 10s | - | CONNECTIONS_TABLE |
| `ws-signal` | 256MB | 10s | - | CONNECTIONS_TABLE, WEBSOCKET_ENDPOINT |
| `face-detection` | 1GB | 30s | - | S3_BUCKET, SESSIONS_TABLE |
| `filter-apply` | 2GB | 60s | sharp | S3_BUCKET |
| `collage-generate` | 2GB | 60s | sharp | S3_BUCKET |
| `caption-generate` | 1GB | 30s | - | S3_BUCKET, SESSIONS_TABLE |
| `print-prepare` | 2GB | 60s | sharp, qrcode | S3_BUCKET |
| `yaji-comment-fast` | 512MB | 10s | - | S3_BUCKET, CONNECTIONS_TABLE, WEBSOCKET_ENDPOINT |
| `yaji-comment-deep` | 1GB | 30s | - | S3_BUCKET, CONNECTIONS_TABLE, WEBSOCKET_ENDPOINT |
| `stats-update` | 256MB | 10s | - | SESSIONS_TABLE |

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
// IoT Policy: print/{deviceId}/job, print/{deviceId}/status
// IoT Rule: print/+/status → Lambda (print-status-handler) → DynamoDB 更新
```

> IoT Core のデバイス証明書・Thing 登録はハッカソン向けに手動 or CLI で実施。
> CDK では IoT Policy と IoT Rule のみ定義。

### 2.7 EventBridge (将来用)

MVP では `POST /sessions/{id}/process` で直接 Step Functions を起動する。
将来的には S3 PutObject → EventBridge Rule → Step Functions の自動トリガーに移行可能。

---

## 3. IAM パーミッション

各 Lambda に最小権限の IAM ポリシーを付与する。

| Lambda | 必要な権限 |
|--------|----------|
| `session-create` | DynamoDB PutItem, S3 PutObject (presigned) |
| `session-get` | DynamoDB GetItem |
| `upload-url` | S3 PutObject (presigned) |
| `process-start` | StepFunctions StartExecution, DynamoDB UpdateItem |
| `download-url` | S3 GetObject (presigned) |
| `ws-*` | DynamoDB PutItem/DeleteItem/Query (connections), API Gateway ManageConnections |
| `face-detection` | Rekognition DetectFaces, S3 GetObject |
| `filter-apply` | S3 GetObject/PutObject |
| `collage-generate` | S3 GetObject/PutObject |
| `caption-generate` | Bedrock InvokeModel, Comprehend DetectSentiment, S3 GetObject, DynamoDB UpdateItem |
| `print-prepare` | S3 GetObject/PutObject |
| `yaji-comment-fast` | Rekognition DetectFaces, S3 GetObject, DynamoDB Query (connections), API Gateway ManageConnections, DynamoDB UpdateItem |
| `yaji-comment-deep` | Bedrock InvokeModel, S3 GetObject, DynamoDB Query (connections), API Gateway ManageConnections, DynamoDB UpdateItem |
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
