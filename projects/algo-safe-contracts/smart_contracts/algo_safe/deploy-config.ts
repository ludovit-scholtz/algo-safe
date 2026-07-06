import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoSafeFactory } from '../artifacts/algo_safe/AlgoSafeClient'

// Below is a showcase of various deployment options you can use in TypeScript Client
export async function deploy() {
  console.log('=== Deploying AlgoSafe ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, {
    defaultSender: deployer.addr,
  })

  const { appClient, result } = await factory.deploy({
    onUpdate: 'append',
    onSchemaBreak: 'append',
    createParams: {
      method: 'createApplication',
      args: { name: 'Algo Safe' },
      extraProgramPages: undefined,
    },
  })

  // Fund the app account so it can cover box minimum balance requirements.
  if (['create', 'replace'].includes(result.operationPerformed)) {
    await algorand.send.payment({
      amount: (1).algo(),
      sender: deployer.addr,
      receiver: appClient.appAddress,
    })
  }

  // Bootstrap the genesis admin signer group (1-of-1, the deployer).
  await appClient.send.bootstrap({
    args: { groupName: 'Admins' },
  })

  const config = await appClient.send.getConfig({ args: { ensureBudgetValue: 0n } })
  console.log(`Deployed Algo Safe (${appClient.appClient.appId}); config:`, config.return)
}
