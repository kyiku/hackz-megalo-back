import { Construct } from 'constructs'
import { CfnOutput } from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import type { Bucket } from 'aws-cdk-lib/aws-s3'

export interface CdnProps {
  readonly stage: string
  readonly bucket: Bucket
}

export class Cdn extends Construct {
  public readonly distribution: cloudfront.Distribution

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id)

    const { stage, bucket } = props

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `receipt-purikura-cdn-${stage}`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      additionalBehaviors: {
        '/downloads/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
      },
    })

    new CfnOutput(this, 'DistributionUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    })
  }
}
