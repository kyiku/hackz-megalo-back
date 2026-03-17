#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { GithubOidcStack } from '../lib/github-oidc-stack'
import { AppStack } from '../lib/app-stack'

const app = new cdk.App()
const stage = app.node.tryGetContext('stage') ?? 'dev'

const env: cdk.Environment = {
  region: 'ap-northeast-1',
}

new GithubOidcStack(app, 'GithubOidcStack', { env })

// dev: 既存スタック名を維持、prod: 別スタックとして作成
const stackName = stage === 'dev'
  ? 'HackzMegaloBackStack'
  : `HackzMegaloBack-${stage}`

new AppStack(app, stackName, { env })
