#!/usr/bin/env node

/**
 * check-program-size — CI gate for the AlgoSafe approval program (audit C-01).
 *
 * The AVM hard ceiling is 8 192 bytes (MaxExtraAppProgramPages=3 → 4 × 2 048).
 * This script fails the build when the compiled approval program exceeds
 * MAX_ALLOWED_BYTES, so size creep is caught in the PR that introduces it
 * instead of at deploy time.
 */

import * as fs from 'fs'
import * as path from 'path'

const AVM_CEILING = 8192
// 5% margin target per the 2026-07-12 audit recommendation.
const MAX_ALLOWED_BYTES = 7800

const ARC56_PATH = path.join(__dirname, '..', 'smart_contracts', 'artifacts', 'algo_safe', 'AlgoSafe.arc56.json')

const arc56 = JSON.parse(fs.readFileSync(ARC56_PATH, 'utf8')) as { byteCode?: { approval?: string } }
const approvalBase64 = arc56.byteCode?.approval
if (!approvalBase64) {
  console.error(`check-program-size: no byteCode.approval in ${ARC56_PATH}`)
  process.exit(1)
}

const size = Buffer.from(approvalBase64, 'base64').length
const line = `AlgoSafe approval program: ${size} bytes (gate ${MAX_ALLOWED_BYTES}, AVM ceiling ${AVM_CEILING}, margin ${AVM_CEILING - size})`

if (size > MAX_ALLOWED_BYTES) {
  console.error(`check-program-size: FAIL — ${line}`)
  console.error('Reduce program size (or, deliberately and with review, raise MAX_ALLOWED_BYTES) before merging.')
  process.exit(1)
}

console.log(`check-program-size: OK — ${line}`)
