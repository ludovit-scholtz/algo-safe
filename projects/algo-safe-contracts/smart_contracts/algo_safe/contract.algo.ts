import { Contract } from '@algorandfoundation/algorand-typescript'

export class AlgoSafe extends Contract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
