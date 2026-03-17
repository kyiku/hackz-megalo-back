import { Construct } from 'constructs'
import { RemovalPolicy } from 'aws-cdk-lib'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import type { Table } from 'aws-cdk-lib/aws-dynamodb'

export interface AppSyncProps {
  readonly stage: string
  readonly sessionsTable: Table
}

export class AppSyncApi extends Construct {
  public readonly api: appsync.GraphqlApi

  constructor(scope: Construct, id: string, props: AppSyncProps) {
    super(scope, id)

    const { stage, sessionsTable } = props

    // -------------------------------------------------------
    // AppSync GraphQL API
    // -------------------------------------------------------
    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: `receipt-purikura-appsync-${stage}`,
      definition: appsync.Definition.fromSchema(
        appsync.SchemaFile.fromAsset(
          require('node:path').join(__dirname, '../schema.graphql'),
        ),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
        },
      },
    })

    // -------------------------------------------------------
    // DynamoDB Data Source
    // -------------------------------------------------------
    const sessionsDs = this.api.addDynamoDbDataSource(
      'SessionsDataSource',
      sessionsTable,
    )

    // -------------------------------------------------------
    // Resolvers
    // -------------------------------------------------------

    // Query: getStats - scan sessions table for today's stats
    sessionsDs.createResolver('GetStatsResolver', {
      typeName: 'Query',
      fieldName: 'getStats',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Scan",
          "limit": 1000
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($total = 0)
        #set($completed = 0)
        #set($failed = 0)
        #foreach($item in $ctx.result.items)
          #set($total = $total + 1)
          #if($item.status == "completed" || $item.status == "printed")
            #set($completed = $completed + 1)
          #end
          #if($item.status == "failed")
            #set($failed = $failed + 1)
          #end
        #end
        {
          "totalSessions": $total,
          "completedSessions": $completed,
          "failedSessions": $failed,
          "lastUpdated": "$util.time.nowISO8601()"
        }
      `),
    })

    // Query: getSession
    sessionsDs.createResolver('GetSessionResolver', {
      typeName: 'Query',
      fieldName: 'getSession',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Query",
          "query": {
            "expression": "sessionId = :sid",
            "expressionValues": {
              ":sid": $util.dynamodb.toDynamoDBJson($ctx.args.sessionId)
            }
          },
          "limit": 1
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($ctx.result.items.size() > 0)
          $util.toJson($ctx.result.items[0])
        #else
          null
        #end
      `),
    })

    // Mutation: publishStats - used by stats-update Lambda to trigger subscription
    // Uses NONE data source (no backend, just passes through to subscribers)
    const noneDs = this.api.addNoneDataSource('NoneDataSource')

    noneDs.createResolver('PublishStatsResolver', {
      typeName: 'Mutation',
      fieldName: 'publishStats',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": {
            "totalSessions": $ctx.args.input.totalSessions,
            "completedSessions": $ctx.args.input.completedSessions,
            "failedSessions": $ctx.args.input.failedSessions,
            "lastUpdated": "$util.time.nowISO8601()"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(
        '$util.toJson($ctx.result)',
      ),
    })

    // Remove API key on stack deletion
    this.api.applyRemovalPolicy(RemovalPolicy.DESTROY)
  }
}
