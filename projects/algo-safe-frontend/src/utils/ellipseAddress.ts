export function ellipseAddress(address: string | null, width = 4): string {
  if (!address) return address ?? ''
  if (address.length <= width * 2 + 3) return address
  return `${address.slice(0, width)}...${address.slice(-width)}`
}
