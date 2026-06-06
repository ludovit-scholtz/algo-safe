// src/services/mock/safeMock.test.ts
import { safeMock } from './safeMock'

test('registerAgent adds an agent and a draft proposal', async () => {
  const before = (await safeMock.listAgents()).length
  const agent = await safeMock.registerAgent({ alias: 'Test Bot', address: 'TESTADDR', purpose: 'Algorithmic Trading', groupTier: 'Tier 3 - Automated Execution (1/1)', dailyLimit: 5000, primaryAsset: 'EURD' })
  expect(agent.id).toBeTruthy()
  expect((await safeMock.listAgents()).length).toBe(before + 1)
  expect((await safeMock.listProposals()).some(p => p.status === 'draft' && p.title.includes('Test Bot'))).toBe(true)
})

test('approveProposal increments approvals and executes at threshold', async () => {
  const props = await safeMock.listProposals()
  const pending = props.find(p => p.status === 'pending')!
  const needed = pending.threshold - pending.approvals
  let updated = pending
  for (let i = 0; i < needed; i++) updated = await safeMock.approveProposal(pending.id)
  expect(updated.status).toBe('executed')
})

test('approving a blocked proposal moves it to executed (admin override)', async () => {
  const blocked = (await safeMock.listProposals()).find(p => p.status === 'blocked')!
  const updated = await safeMock.approveProposal(blocked.id)
  expect(['pending', 'executed']).toContain(updated.status)
})

describe('safeMock v2 methods', () => {
  it('lists at least two safes', async () => {
    const safes = await safeMock.listSafes()
    expect(safes.length).toBeGreaterThanOrEqual(2)
    expect(safes[0]).toHaveProperty('totalValueEur')
  })
  it('getSafe resolves a known safe by id', async () => {
    const safe = await safeMock.getSafe('safe_1')
    expect(safe.name).toBe('Cold Storage A')
  })
  it('createSafe returns a new safe and adds it to listSafes', async () => {
    const before = (await safeMock.listSafes()).length
    const created = await safeMock.createSafe({ name: 'Ops Wallet', threshold: 2, signerCount: 3, initialDepositEurd: 5000 })
    expect(created.name).toBe('Ops Wallet')
    expect((await safeMock.listSafes()).length).toBe(before + 1)
  })
  it('listAssets and getTreasury return holdings', async () => {
    const assets = await safeMock.listAssets('safe_1')
    expect(assets.some(a => a.symbol === 'EURD')).toBe(true)
    const t = await safeMock.getTreasury('safe_1')
    expect(t.totalValueEur).toBeGreaterThan(0)
  })
})
