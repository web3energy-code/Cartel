import { Account } from 'near-api-js'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const NEAR_NETWORK = process.env.NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'

export const NEAR_RPC_URL =
  process.env.NEAR_RPC_URL ||
  (NEAR_NETWORK === 'mainnet'
    ? 'https://free.rpc.fastnear.com'
    : 'https://test.rpc.fastnear.com')

export const FEE_BPS = Number(process.env.MARKETPLACE_FEE_BPS ?? 1000) // 10%
export const ESCROW_HOURS = Number(process.env.ESCROW_HOURS ?? 24)

const YOCTO = 10n ** 24n
const CLOCK_SKEW_MS = 120_000

// ---------------------------------------------------------------------------
// Money: NEAR has 24 decimals, so every amount is a BigInt of yoctoNEAR and is
// stored as a plain digit string. Floating point is never used for money.
// ---------------------------------------------------------------------------

export function parseNear(value: string): bigint | null {
  const text = String(value).trim()

  if (!/^\d+(\.\d{1,24})?$/.test(text)) return null

  const [whole, fraction = ''] = text.split('.')

  return BigInt(whole) * YOCTO + BigInt(fraction.padEnd(24, '0'))
}

export function formatNear(yocto: bigint | string, maxDecimals = 6): string {
  const amount = BigInt(yocto)
  const whole = amount / YOCTO
  const fraction = (amount % YOCTO).toString().padStart(24, '0').slice(0, maxDecimals)
  const trimmed = fraction.replace(/0+$/, '')

  return trimmed ? `${whole}.${trimmed}` : `${whole}`
}

export function splitFee(total: bigint, bps = FEE_BPS) {
  const fee = (total * BigInt(bps)) / 10_000n

  return { fee, seller: total - fee }
}

export function isAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
  )
}

// ---------------------------------------------------------------------------
// Reading the chain
// ---------------------------------------------------------------------------

async function rpc(method: string, params: unknown): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch(NEAR_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'cartel', method, params }),
      signal: controller.signal,
    })

    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export type TxLookup =
  | { found: true; tx: any; blockTimeMs: number | null }
  | { found: false; unreachable: boolean }

// Fetches a finished transaction. "found: false" means the network does not
// know it (yet), so the caller can simply ask again in a few seconds.
export async function lookupTransaction(txHash: string, signerId: string): Promise<TxLookup> {
  let result: any

  try {
    result = await rpc('tx', { tx_hash: txHash, sender_account_id: signerId, wait_until: 'FINAL' })
  } catch {
    return { found: false, unreachable: true }
  }

  if (result?.error || !result?.result) {
    const name = String(result?.error?.cause?.name ?? result?.error?.name ?? '')
    const notYet = /UNKNOWN_TRANSACTION|TIMEOUT/i.test(name)

    return { found: false, unreachable: !notYet }
  }

  const tx = result.result
  let blockTimeMs: number | null = null

  try {
    const blockHash = tx.transaction_outcome?.block_hash
    const block = blockHash ? await rpc('block', { block_id: blockHash }) : null
    const ns = block?.result?.header?.timestamp_nanosec ?? block?.result?.header?.timestamp

    if (ns) blockTimeMs = Number(BigInt(String(ns)) / 1_000_000n)
  } catch {
    blockTimeMs = null
  }

  return { found: true, tx, blockTimeMs }
}

export interface PaymentCheckOrder {
  buyer_account: string
  escrow_account: string
  total_yocto: string
  created_at: string
}

function hasFailure(status: any): boolean {
  return !!status && typeof status === 'object' && 'Failure' in status
}

// Decides from the transaction record whether the buyer really sent this order's
// amount to the escrow account.
export function checkPayment(
  tx: any,
  blockTimeMs: number | null,
  order: PaymentCheckOrder,
): { ok: true } | { ok: false; reason: string } {
  if (!tx?.transaction) {
    return { ok: false, reason: 'Transaction details are not available yet.' }
  }

  if (hasFailure(tx.status) || (tx.receipts_outcome ?? []).some((r: any) => hasFailure(r?.outcome?.status))) {
    return { ok: false, reason: 'That transaction failed on the network.' }
  }

  if (
    typeof tx.status !== 'object' ||
    !tx.status ||
    (!('SuccessValue' in tx.status) && !('SuccessReceiptId' in tx.status))
  ) {
    return { ok: false, reason: 'That transaction has not finished yet.' }
  }

  if (tx.transaction.signer_id !== order.buyer_account) {
    return { ok: false, reason: 'That transaction was not sent by the buyer account.' }
  }

  if (tx.transaction.receiver_id !== order.escrow_account) {
    return { ok: false, reason: 'That transaction was not sent to the escrow account.' }
  }

  if (blockTimeMs !== null && blockTimeMs + CLOCK_SKEW_MS < Date.parse(order.created_at)) {
    return { ok: false, reason: 'That transaction is older than this order.' }
  }

  let deposited = 0n

  for (const action of tx.transaction.actions ?? []) {
    if (action && typeof action === 'object' && 'Transfer' in action) {
      deposited += BigInt(String(action.Transfer?.deposit ?? '0'))
    }
  }

  if (deposited < BigInt(order.total_yocto)) {
    return { ok: false, reason: 'The escrow received less than the order total.' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Paying out of escrow
// ---------------------------------------------------------------------------

export function escrowConfigured() {
  return !!process.env.ESCROW_ACCOUNT_ID && !!process.env.ESCROW_PRIVATE_KEY
}

export function feeAccount(): string | null {
  const id = process.env.FEE_ACCOUNT_ID

  return isAccountId(id) ? id : null
}

// Sends NEAR from the escrow account and returns the transaction hash.
export async function sendFromEscrow(receiverId: string, amount: bigint): Promise<string> {
  const accountId = process.env.ESCROW_ACCOUNT_ID
  const key = process.env.ESCROW_PRIVATE_KEY

  if (!accountId || !key) {
    throw new Error('Escrow is not configured on the server.')
  }

  if (amount <= 0n) {
    throw new Error('Nothing to pay out.')
  }

  const account = new Account(accountId, NEAR_RPC_URL, key as `ed25519:${string}`)
  const result: any = await account.transfer({ receiverId, amount })

  const hash = result?.transaction?.hash ?? result?.transaction_outcome?.id

  if (!hash) throw new Error('Payout was sent but no transaction id came back.')

  return String(hash)
}

// What a finished transaction sent to `receiver` from `signer`: the summed Transfer deposits.
export function depositFromTx(
  tx: any,
  signer: string,
  receiver: string,
): { ok: true; deposit: bigint } | { ok: false; reason: string } {
  if (!tx?.transaction) return { ok: false, reason: 'Transaction details are not available yet.' }

  if (hasFailure(tx.status) || (tx.receipts_outcome ?? []).some((r: any) => hasFailure(r?.outcome?.status))) {
    return { ok: false, reason: 'That transaction failed on the network, so nothing was sent.' }
  }

  if (typeof tx.status !== 'object' || !tx.status || (!('SuccessValue' in tx.status) && !('SuccessReceiptId' in tx.status))) {
    return { ok: false, reason: 'That transaction has not finished yet.' }
  }

  if (tx.transaction.signer_id !== signer) return { ok: false, reason: 'That transaction was not sent by this account.' }
  if (tx.transaction.receiver_id !== receiver) return { ok: false, reason: 'That transaction was not sent to the escrow account.' }

  let deposit = 0n

  for (const action of tx.transaction.actions ?? []) {
    if (action && typeof action === 'object' && 'Transfer' in action) deposit += BigInt(String(action.Transfer?.deposit ?? '0'))
  }

  return deposit > 0n ? { ok: true, deposit } : { ok: false, reason: 'That transaction did not send any NEAR.' }
}
