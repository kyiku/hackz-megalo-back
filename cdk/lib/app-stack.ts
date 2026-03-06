import * as cdk from 'aws-cdk-lib'
import type { Construct } from 'constructs'

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // TODO: Add application resources (S3, DynamoDB, Lambda, etc.)
  }
}
