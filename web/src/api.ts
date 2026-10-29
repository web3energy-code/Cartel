// Address of your Cartel API (the Vercel project that holds the "api" folder).
// You can also set it with the VITE_API_URL environment variable on Vercel.
export const API_URL: string = (
  (import.meta as any).env?.VITE_API_URL || 'https://YOUR-CARTEL-API.vercel.app'
).replace(/\/$/, '')

export const NETWORK: 'testnet' | 'mainnet' =
  (import.meta as any).env?.VITE_NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'

export interface Product {
  id: string
  sellerAccount: string
  name: string
  description: string
  category: string
  condition: string
  priceNear: string
  priceYocto: string
  quantity: number
  location: string
  images: string[]
  createdAt: string
}

export interface OrderItem {
  productId: string
  name: string
  image: string | null
  unitPriceNear: string
  quantity: number
}

export interface Order {
  id: string
  buyerAccount: string
  sellerAccount: string
  escrowAccount: string
  status: string
  network: string
  totalNear: string
  totalYocto: string
  feeNear: string
  sellerReceivesNear: string
  txHash: string | null
  paidAt: string | null
  shippedAt: string | null
  releaseAfter: string | null
  releasedAt: string | null
  sellerPayoutTx: string | null
  refundTx: string | null
  disputeReason: string | null
  createdAt: string
  items: OrderItem[]
}

export interface Config {
  network: string
  escrowAccount: string | null
  escrowReady: boolean
  feePercent: number
  escrowHours: number
  categories: string[]
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${API_URL}${path}`, init)
  } catch {
    throw new Error('Could not reach Cartel. Check your connection and try again.')
  }

  let data: any = {}

  try {
    data = await response.json()
  } catch {
    // not JSON
  }

  // 202 = "the network has not finished that payment yet"
  if (response.status === 202 && data.pending) return data as T

  if (!response.ok || data.success === false) {
    throw new Error(data.error || 'Something went wrong. Please try again.')
  }

  return data as T
}

export function post<T = any>(path: string, body: unknown) {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function explorerTx(hash: string) {
  return NETWORK === 'mainnet'
    ? `https://nearblocks.io/txns/${hash}`
    : `https://testnet.nearblocks.io/txns/${hash}`
}

export function shortAccount(id: string) {
  return id.length > 22 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
}

export function near(amount: string) {
  return `${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 6 })} NEAR`
}

// The browser only ever shows prices; the server recalculates every amount.
export function multiply(price: string, quantity: number) {
  return String(Number(price) * quantity)
}

export interface Profile {
  account: string
  username: string | null
  displayName: string | null
  bio: string
  location: string
  avatarUrl: string | null
  createdAt: string | null
}

export interface Review {
  id: string
  orderId: string
  sellerAccount: string
  buyerAccount: string
  rating: number
  comment: string
  createdAt: string
  reviewer?: Profile
}

export interface Message {
  id: string
  from: string
  to: string
  body: string
  productId: string | null
  createdAt: string
  readAt: string | null
}

export interface Conversation {
  with: string
  profile: Profile
  last: Message
  unread: number
}

// The name to show for someone: display name, then @username, then their wallet account.
export function nameOf(profile: Profile | undefined | null, account: string) {
  if (profile?.displayName) return profile.displayName
  if (profile?.username) return `@${profile.username}`

  return shortAccount(account)
}
