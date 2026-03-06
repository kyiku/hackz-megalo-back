#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { GithubOidcStack } from '../lib/github-oidc-stack'
import { AppStack } from '../lib/app-stack'

const app = new cdk.App()

const env: cdk.Environment = {
  region: 'ap-northeast-1',
}

new GithubOidcStack(app, 'GithubOidcStack', { env })
new AppStack(app, 'HackzMegaloBackStack', { env })
