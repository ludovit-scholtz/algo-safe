import { ellipseAddress } from './ellipseAddress'

describe('ellipseAddress', () => {
  it('should use four leading and trailing characters by default', () => {
    const address = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = ellipseAddress(address)
    expect(result).toBe('aaaa...aaaa')
  })

  it('should return ellipsed address with specified width', () => {
    const address = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = ellipseAddress(address, 4)
    expect(result).toBe('aaaa...aaaa')
  })

  it('should return short addresses unchanged', () => {
    const address = 'ALGO123'
    const result = ellipseAddress(address)
    expect(result).toBe('ALGO123')
  })

  it('should return empty string when address is empty', () => {
    const address = ''
    const result = ellipseAddress(address)
    expect(result).toBe('')
  })
})
