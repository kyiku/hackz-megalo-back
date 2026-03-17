import { Construct } from 'constructs'
import {
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib'
import {
  AttributeType,
  BillingMode,
  Table,
} from 'aws-cdk-lib/aws-dynamodb'
import {
  Bucket,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3'

export interface StorageProps {
  readonly stage: string
}

export class Storage extends Construct {
  public readonly bucket: Bucket
  public readonly sessionsTable: Table
  public readonly connectionsTable: Table

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id)

    const { stage } = props

    // S3 Bucket
    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: `receipt-purikura-${stage}`,
      transferAcceleration: true,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        { prefix: 'originals/', expiration: Duration.days(7) },
        { prefix: 'filtered/', expiration: Duration.days(7) },
        { prefix: 'collages/', expiration: Duration.days(30) },
        { prefix: 'print-ready/', expiration: Duration.days(7) },
        { prefix: 'downloads/', expiration: Duration.days(30) },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      eventBridgeEnabled: true,
    })

    // DynamoDB Sessions Table
    this.sessionsTable = new Table(this, 'SessionsTable', {
      tableName: `receipt-purikura-sessions-${stage}`,
      partitionKey: { name: 'sessionId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    })

    // DynamoDB Connections Table
    this.connectionsTable = new Table(this, 'ConnectionsTable', {
      tableName: `receipt-purikura-connections-${stage}`,
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    })

    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'sessionId-index',
      partitionKey: { name: 'sessionId', type: AttributeType.STRING },
    })

    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'roomId-index',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
    })
  }
}
