#!/usr/bin/env node

/**
 * Script to compute SHA256 hashes of contract bytecode for audit verification
 * Reads ARC-56 JSON files and computes hashes of approval and clear programs
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

interface Arc56ByteCode {
  approval: string
  clear: string
}

interface Arc56Data {
  name: string
  byteCode: Arc56ByteCode
}

function decodeBase64(base64String: string): Buffer {
  return Buffer.from(base64String, 'base64')
}

function computeSha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function processContract(arc56Path: string): void {
  try {
    const data = fs.readFileSync(arc56Path, 'utf8')
    const arc56: Arc56Data = JSON.parse(data)

    const approvalBytes = decodeBase64(arc56.byteCode.approval)
    const clearBytes = decodeBase64(arc56.byteCode.clear)

    const approvalHash = computeSha256(approvalBytes)
    const clearHash = computeSha256(clearBytes)

    console.log(`**${arc56.name}.algo.ts**:`)
    console.log(`- **Approval Program SHA256**: \`${approvalHash}\``)
    console.log(`- **Clear Program SHA256**: \`${clearHash}\``)
    console.log('')
  } catch (error) {
    console.error(`Error processing ${arc56Path}:`, error)
  }
}

function main() {
  const artifactsDir = path.join(__dirname, '..', 'smart_contracts', 'artifacts', 'algo_safe')
  const contractFiles = ['AlgoSafe.arc56.json']

  console.log('### Contract Bytecode Hashes\n')
  console.log(
    'The following SHA256 hashes verify the exact bytecode of the smart contracts audited. These hashes are computed from the base64-decoded approval and clear program bytecode in the generated ARC-56 JSON files.\n',
  )

  for (const file of contractFiles) {
    const filePath = path.join(artifactsDir, file)
    if (fs.existsSync(filePath)) {
      processContract(filePath)
    } else {
      console.error(`File not found: ${filePath}`)
    }
  }

  console.log(
    '*Note: To compute these hashes, decode the base64 values from `byteCode.approval` and `byteCode.clear` in the respective `smart_contracts/artifacts/*.arc56.json` files, then compute SHA256 of the raw bytes.*',
  )
}

if (require.main === module) {
  main()
}
