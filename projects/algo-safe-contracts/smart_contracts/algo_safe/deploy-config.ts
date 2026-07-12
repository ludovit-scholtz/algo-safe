import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoSafeFactory } from '../artifacts/algo_safe/AlgoSafeClient'
import { AlgoSafeTxnValidatorFactory } from '../artifacts/algo_safe_validator/AlgoSafeTxnValidatorClient'

// Below is a showcase of various deployment options you can use in TypeScript Client
export async function deploy() {
  console.log('=== Deploying AlgoSafe ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  // The safe pins the AlgoSafeTxnValidator library by bytecode hash at
  // createApplication, so the validator must exist first. factory.deploy is
  // idempotent — an existing deployment with the same bytecode is reused.
  const validatorFactory = algorand.client.getTypedAppFactory(AlgoSafeTxnValidatorFactory, {
    defaultSender: deployer.addr,
  })
  const { appClient: validatorClient } = await validatorFactory.deploy({})
  console.log(`AlgoSafeTxnValidator app ID: ${validatorClient.appId}`)

  const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, {
    defaultSender: deployer.addr,
  })

  const { appClient, result } = await factory.deploy({
    onUpdate: 'append',
    onSchemaBreak: 'append',
    createParams: {
      method: 'createApplication',
      args: { name: 'Algo Safe', validatorAppId: validatorClient.appId },
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

  const globalState = await appClient.state.global.getAll()
  console.log(`Deployed Algo Safe (${appClient.appClient.appId}); config:`, globalState)
}
