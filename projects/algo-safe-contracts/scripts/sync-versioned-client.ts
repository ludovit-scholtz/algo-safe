#!/usr/bin/env node

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

type Arc56ByteCode = {
  approval: string
  clear: string
}

type Arc56Data = {
  byteCode: Arc56ByteCode
}

const ROOT_DIR = path.join(__dirname, '..')
const ARTIFACTS_DIR = path.join(ROOT_DIR, 'smart_contracts', 'artifacts', 'algo_safe')
const CLIENTS_DIR = path.join(ROOT_DIR, 'clients')
const ARC56_PATH = path.join(ARTIFACTS_DIR, 'AlgoSafe.arc56.json')
const GENERATED_REGISTRY_PATH = path.join(ROOT_DIR, 'src', 'versioned-clients.generated.ts')
const GENERATED_LATEST_EXPORTS_PATH = path.join(ROOT_DIR, 'src', 'latest-client.ts')

function decodeBase64(base64String: string): Buffer {
  return Buffer.from(base64String, 'base64')
}

function computeSha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function readArc56(pathToArc56: string): Arc56Data {
  return JSON.parse(fs.readFileSync(pathToArc56, 'utf8')) as Arc56Data
}

function ensureArtifactsExist() {
  if (!fs.existsSync(ARC56_PATH)) {
    throw new Error(`Missing ARC-56 artifact: ${ARC56_PATH}`)
  }
}

function syncHashClientDirectory(hash: string) {
  const versionedClientDir = path.join(CLIENTS_DIR, hash)
  fs.rmSync(versionedClientDir, { recursive: true, force: true })
  fs.mkdirSync(CLIENTS_DIR, { recursive: true })
  fs.cpSync(ARTIFACTS_DIR, versionedClientDir, { recursive: true })

  const versionedClientPath = path.join(versionedClientDir, 'AlgoSafeClient.ts')
  const versionedClientSource = fs.readFileSync(versionedClientPath, 'utf8')
  const browserSafeClientSource = versionedClientSource.replace(
    "return this.value !== undefined ? Buffer.from(this.value).toString('utf-8') : undefined",
    'return this.value !== undefined ? new TextDecoder().decode(this.value) : undefined',
  )

  fs.writeFileSync(versionedClientPath, browserSafeClientSource)
}

function getHashDirectories() {
  if (!fs.existsSync(CLIENTS_DIR)) {
    return []
  }

  return fs
    .readdirSync(CLIENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((entry) => fs.existsSync(path.join(CLIENTS_DIR, entry, 'AlgoSafeClient.ts')))
    .sort()
}

function readGeneratedClientExports() {
  const generatedClientPath = path.join(ARTIFACTS_DIR, 'AlgoSafeClient.ts')
  const generatedClient = fs.readFileSync(generatedClientPath, 'utf8')
  const exportMatches = generatedClient.matchAll(/^export (?:const|type|function|interface|class) (\w+)/gm)
  const exportNames = Array.from(new Set(Array.from(exportMatches, (match) => match[1]))).sort()

  return {
    valueExports: exportNames.filter((name) => name !== 'AlgoSafeClient' && !isTypeOnlyExport(name)),
    typeExports: exportNames.filter((name) => name !== 'AlgoSafeClient' && isTypeOnlyExport(name)),
  }
}

function isTypeOnlyExport(name: string) {
  return (
    name === 'BinaryState' ||
    name === 'Expand' ||
    name.startsWith('Object') ||
    name.endsWith('Args') ||
    name.endsWith('Returns') ||
    name.endsWith('Types') ||
    name.endsWith('Signatures') ||
    name.endsWith('Params') ||
    name.endsWith('State') ||
    name.endsWith('Composer') ||
    name.endsWith('Results') ||
    [
      'AdminChange',
      'Approval',
      'Member',
      'Object78E87395',
      'Object9F556C53',
      'PaymentPayload',
      'Proposal',
      'SignerGroup',
      'MethodArgs',
      'MethodReturn',
      'CallParams',
    ].includes(name)
  )
}

function createImportAlias(hash: string) {
  return `AlgoSafeClient_${hash}`
}

function writeVersionedClientRegistry(latestHash: string, hashes: string[]) {
  const imports = hashes
    .map((hash) => `import { AlgoSafeClient as ${createImportAlias(hash)} } from '../clients/${hash}/AlgoSafeClient'`)
    .join('\n')

  const contractHashes = hashes.map((hash) => `  '${hash}',`).join('\n')
  const registryEntries = hashes.map((hash) => `  '${hash}': ${createImportAlias(hash)},`).join('\n')

  const fileContent = `${imports}\n\nexport const LATEST_CONTRACT_HASH = '${latestHash}' as const\nexport const CONTRACT_HASHES = [\n${contractHashes}\n] as const\nexport const DEFAULT_CLIENT_VERSION = 'latest' as const\n\nexport type ContractHash = (typeof CONTRACT_HASHES)[number]\nexport type ContractVersion = ContractHash | typeof DEFAULT_CLIENT_VERSION | string\nexport type AlgoSafeClientConstructor = typeof ${createImportAlias(latestHash)}\n\nconst CLIENT_REGISTRY = {\n${registryEntries}\n} satisfies Record<ContractHash, AlgoSafeClientConstructor>\n\nexport function getClientRegistry() {\n  return CLIENT_REGISTRY\n}\n`

  fs.writeFileSync(GENERATED_REGISTRY_PATH, fileContent)
}

function writeLatestClientExports(latestHash: string) {
  const exportSource = `../clients/${latestHash}/AlgoSafeClient`
  const { valueExports, typeExports } = readGeneratedClientExports()
  const valueSection =
    valueExports.length > 0 ? `export {\n  ${valueExports.join(',\n  ')},\n} from '${exportSource}'\n\n` : ''
  const typeSection =
    typeExports.length > 0 ? `export type {\n  ${typeExports.join(',\n  ')},\n} from '${exportSource}'\n` : ''

  fs.writeFileSync(GENERATED_LATEST_EXPORTS_PATH, `${valueSection}${typeSection}`)
}

function main() {
  ensureArtifactsExist()

  const arc56 = readArc56(ARC56_PATH)
  const approvalHash = computeSha256(decodeBase64(arc56.byteCode.approval))

  syncHashClientDirectory(approvalHash)
  const hashes = getHashDirectories()

  writeVersionedClientRegistry(approvalHash, hashes)
  writeLatestClientExports(approvalHash)

  console.log(`Synced Algo Safe client for approval hash ${approvalHash}`)
}

main()
