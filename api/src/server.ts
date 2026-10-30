import express, { type Request, type Response } from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  ESCROW_HOURS,
  FEE_BPS,
  NEAR_NETWORK,
  checkPayment,
  escrowConfigured,
  feeAccount,
  formatNear,
  isAccountId,
  lookupTransaction,
  parseNear,
  sendFromEscrow,
  splitFee,
} from './near.js'
import { registerSocial } from './social.js'

// The two things that talk to the NEAR network, kept in one place so tests can swap them.
export const chain = { lookupTransaction, sendFromEscrow }

const app = express()

const PRODUCTS = 'cartel_products'
const ORDERS = 'cartel_orders'
const ITEMS = 'cartel_order_items'
const BUCKET = 'cartel-products'

const MAX_CART_LINES = 30
const MAX_QUANTITY = 99
const MAX_IMAGES = 5
const CATEGORIES = ['Electronics', 'Fashion', 'Beauty', 'Home', 'Accessories', 'Gaming', 'Other']

app.use(cors())
app.use(express.json({ limit: '1mb' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_IMAGES },
})

let supabase: SupabaseClient | null = null

export function setDb(client: SupabaseClient | null) {
  supabase = client
}

function db(): SupabaseClient {
  if (supabase) return supabase

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Database is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  }

  supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  return supabase
}

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, error: message })
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

// ---------------------------------------------------------------------------
// Shapes sent to the browser
// ---------------------------------------------------------------------------

// The buyer's delivery details, checked and trimmed. Returns an error message for the buyer, or the clean object.
function cleanDelivery(raw: any): { error: string } | { delivery: Record<string, string> } {
  const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

  const delivery = {
    name: text(raw?.name, 80),
    phone: text(raw?.phone, 24),
    address: text(raw?.address, 200),
    city: text(raw?.city, 60),
    state: text(raw?.state, 60),
    country: text(raw?.country, 60),
    notes: text(raw?.notes, 200),
  }

  if (delivery.name.length < 2) return { error: 'Enter the name of the person receiving the order.' }
  if (!/^\+?[0-9 ()-]{6,24}$/.test(delivery.phone)) return { error: 'Enter a phone number the seller can reach.' }
  if (delivery.address.length < 5) return { error: 'Enter your delivery address.' }
  if (delivery.city.length < 2) return { error: 'Enter your city.' }
  if (delivery.country.length < 2) return { error: 'Enter your country.' }

  return { delivery }
}

function publicProduct(row: any) {
  return {
    id: row.id,
    sellerAccount: row.seller_account,
    name: row.name,
    description: row.description,
    category: row.category,
    condition: row.condition,
    priceNear: formatNear(row.price_yocto),
    priceYocto: row.price_yocto,
    deliveryFeeNear: formatNear(row.delivery_fee_yocto ?? '0'),
    quantity: row.quantity,
    location: row.location,
    images: row.image_urls ?? [],
    status: row.status,
    createdAt: row.created_at,
  }
}

function publicOrder(row: any) {
  const { fee, seller } = splitFee(BigInt(row.total_yocto), Number(row.fee_bps ?? FEE_BPS))

  return {
    id: row.id,
    buyerAccount: row.buyer_account,
    sellerAccount: row.seller_account,
    escrowAccount: row.escrow_account,
    status: row.status,
    network: row.network,
    totalNear: formatNear(row.total_yocto),
    totalYocto: row.total_yocto,
    feeNear: formatNear(fee),
    sellerReceivesNear: formatNear(seller),
    txHash: row.tx_hash ?? null,
    paidAt: row.paid_at ?? null,
    shippedAt: row.shipped_at ?? null,
    releaseAfter: row.release_after ?? null,
    releasedAt: row.released_at ?? null,
    sellerPayoutTx: row.seller_payout_tx ?? null,
    refundTx: row.refund_tx ?? null,
    disputeReason: row.dispute_reason ?? null,
    delivery: row.delivery ?? null,
    createdAt: row.created_at,
    items: (row.items ?? []).map((item: any) => ({
      productId: item.product_id,
      name: item.product_name,
      image: item.image_url,
      unitPriceNear: formatNear(item.unit_price_yocto),
      quantity: item.quantity,
    })),
  }
}

async function loadOrder(orderId: string) {
  const { data: order } = await db().from(ORDERS).select('*').eq('id', orderId).maybeSingle()

  if (!order) return null

  const { data: items } = await db().from(ITEMS).select('*').eq('order_id', orderId)

  return { ...order, items: items ?? [] }
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.json({ service: 'cartel-api', ok: true })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cartel-api', network: NEAR_NETWORK, time: new Date().toISOString() })
})

app.get('/config', (_req, res) => {
  res.json({
    success: true,
    network: NEAR_NETWORK,
    escrowAccount: process.env.ESCROW_ACCOUNT_ID ?? null,
    escrowReady: escrowConfigured() && !!feeAccount(),
    feePercent: FEE_BPS / 100,
    escrowHours: ESCROW_HOURS,
    categories: CATEGORIES,
  })
})

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

app.get('/products', async (req: Request, res: Response) => {
  try {
    let query = db()
      .from(PRODUCTS)
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(200)

    const seller = String(req.query.seller ?? '')

    if (seller) {
      query = query.eq('seller_account', seller)
    } else {
      query = query.gt('quantity', 0)
    }

    const { data, error } = await query

    if (error) throw new Error('Could not load products.')

    res.set('Cache-Control', 'no-store')
    res.json({ success: true, products: (data ?? []).map(publicProduct) })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not load products.'))
  }
})

app.get('/products/:id', async (req: Request, res: Response) => {
  try {
    const { data } = await db().from(PRODUCTS).select('*').eq('id', req.params.id).maybeSingle()

    if (!data || data.status === 'removed') {
      fail(res, 404, 'Product not found.')
      return
    }

    res.json({ success: true, product: publicProduct(data) })
  } catch {
    fail(res, 404, 'Product not found.')
  }
})

app.post('/products', upload.array('images', MAX_IMAGES), async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {}
    const sellerAccount = String(body.sellerAccount ?? '').trim()
    const name = String(body.name ?? '').trim()
    const description = String(body.description ?? '').trim()
    const category = String(body.category ?? '').trim()
    const condition = String(body.condition ?? 'New').trim()
    const location = String(body.location ?? '').trim()
    const price = parseNear(String(body.price ?? ''))
    const quantity = Number(body.quantity)
    const files = (req.files as Express.Multer.File[] | undefined) ?? []

    if (!isAccountId(sellerAccount)) return fail(res, 400, 'Connect your NEAR wallet first.')
    if (name.length < 3 || name.length > 120) return fail(res, 400, 'Product name must be 3–120 characters.')
    if (description.length < 10 || description.length > 3000) return fail(res, 400, 'Description must be 10–3000 characters.')
    if (!CATEGORIES.includes(category)) return fail(res, 400, 'Choose a category.')
    if (!price || price <= 0n) return fail(res, 400, 'Enter a price in NEAR (for example 2.5).')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return fail(res, 400, 'Quantity must be a whole number of at least 1.')
    if (files.length < 1) return fail(res, 400, 'Add at least one photo.')

    // Delivery is already included in the price. The fee is stored only so the page can show it.
    const feeText = String(body.deliveryFee ?? '').trim()
    const deliveryFee = feeText === '' ? 0n : parseNear(feeText)

    if (deliveryFee === null) return fail(res, 400, 'Enter the delivery fee as a number of NEAR, or leave it empty.')
    if (deliveryFee > price) return fail(res, 400, 'The delivery fee cannot be more than the full price.')

    const urls: string[] = []

    for (const file of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
        return fail(res, 400, 'Photos must be JPG, PNG or WebP.')
      }

      const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg'
      const path = `${sellerAccount}/${randomUUID()}.${extension}`

      const { error } = await db().storage.from(BUCKET).upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

      if (error) throw new Error('Could not upload a photo. Please try again.')

      urls.push(db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    }

    const { data, error } = await db()
      .from(PRODUCTS)
      .insert({
        seller_account: sellerAccount,
        name,
        description,
        category,
        condition,
        location,
        price_yocto: price.toString(),
        delivery_fee_yocto: deliveryFee.toString(),
        quantity,
        image_urls: urls,
        status: 'published',
      })
      .select('*')
      .single()

    if (error || !data) throw new Error('Could not save your listing.')

    res.status(201).json({ success: true, product: publicProduct(data) })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not publish your listing.'))
  }
})

app.post('/products/:id/remove', async (req: Request, res: Response) => {
  try {
    const seller = String(req.body?.sellerAccount ?? '')

    const { data, error } = await db()
      .from(PRODUCTS)
      .update({ status: 'removed' })
      .eq('id', req.params.id)
      .eq('seller_account', seller)
      .select('id')

    if (error || !data || data.length === 0) return fail(res, 404, 'Listing not found.')

    res.json({ success: true })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not remove the listing.'))
  }
})

// ---------------------------------------------------------------------------
// Orders and escrow
// ---------------------------------------------------------------------------

// Turn a cart into one order per seller. Prices and stock come from the
// database, never from the browser.
app.post('/orders/checkout', async (req: Request, res: Response) => {
  try {
    if (!escrowConfigured() || !feeAccount()) {
      return fail(res, 503, 'Payments are not switched on yet. Escrow is not configured.')
    }

    const buyer = String(req.body?.buyerAccount ?? '').trim()
    const lines = req.body?.items

    if (!isAccountId(buyer)) return fail(res, 400, 'Connect your NEAR wallet first.')

    const checked = cleanDelivery(req.body?.delivery)

    if ('error' in checked) return fail(res, 400, checked.error)

    if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_CART_LINES) {
      return fail(res, 400, 'Your cart is empty or too large.')
    }

    const wanted = new Map<string, number>()

    for (const line of lines) {
      const productId = String(line?.productId ?? '')
      const quantity = Number(line?.quantity)

      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        return fail(res, 400, 'One of the cart items is invalid.')
      }

      wanted.set(productId, (wanted.get(productId) ?? 0) + quantity)
    }

    const { data: products, error } = await db().from(PRODUCTS).select('*').in('id', Array.from(wanted.keys()))

    if (error) throw new Error('Could not read the products.')

    const byId = new Map<string, any>((products ?? []).map((row: any) => [String(row.id), row]))
    const bySeller = new Map<string, Array<{ product: any; quantity: number }>>()

    for (const [productId, quantity] of wanted) {
      const product = byId.get(productId)

      if (!product || product.status !== 'published') {
        return fail(res, 409, 'An item in your cart is no longer available. Please remove it.')
      }

      if (Number(product.quantity) < quantity) {
        return fail(res, 409, `Only ${Number(product.quantity)} of “${product.name}” left in stock.`)
      }

      if (product.seller_account === buyer) {
        return fail(res, 409, `You cannot buy your own listing “${product.name}”.`)
      }

      const list = bySeller.get(product.seller_account) ?? []

      list.push({ product, quantity })
      bySeller.set(product.seller_account, list)
    }

    const created: any[] = []

    for (const [seller, lineItems] of bySeller) {
      const total = lineItems.reduce(
        (sum, line) => sum + BigInt(line.product.price_yocto) * BigInt(line.quantity),
        0n,
      )

      const { data: order, error: orderError } = await db()
        .from(ORDERS)
        .insert({
          buyer_account: buyer,
          seller_account: seller,
          escrow_account: process.env.ESCROW_ACCOUNT_ID,
          total_yocto: total.toString(),
          delivery: checked.delivery,
          fee_bps: FEE_BPS,
          status: 'awaiting_payment',
          network: NEAR_NETWORK,
        })
        .select('*')
        .single()

      if (orderError || !order) throw new Error('Could not create your order.')

      const { error: itemsError } = await db().from(ITEMS).insert(
        lineItems.map((line) => ({
          order_id: order.id,
          product_id: String(line.product.id),
          product_name: String(line.product.name),
          image_url: line.product.image_urls?.[0] ?? null,
          unit_price_yocto: String(line.product.price_yocto),
          quantity: line.quantity,
        })),
      )

      if (itemsError) throw new Error('Could not save the order items.')

      created.push(await loadOrder(order.id))
    }

    res.status(201).json({ success: true, orders: created.map(publicOrder) })
  } catch (error) {
    console.error('Checkout failed:', errorMessage(error, ''))
    fail(res, 500, errorMessage(error, 'Could not start checkout.'))
  }
})

// "I paid": the order only moves into escrow after the server reads the
// transaction from the NEAR network and sees the money arrive.
app.post('/orders/:orderId/verify', async (req: Request, res: Response) => {
  try {
    const buyer = String(req.body?.buyerAccount ?? '').trim()
    const txHash = String(req.body?.txHash ?? '').trim()

    if (!isAccountId(buyer)) return fail(res, 400, 'A valid buyer account is required.')
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) return fail(res, 400, 'A valid transaction hash is required.')

    const order = await loadOrder(String(req.params.orderId))

    if (!order || order.buyer_account !== buyer) return fail(res, 404, 'Order not found.')

    if (order.status !== 'awaiting_payment') {
      if (order.tx_hash === txHash) return void res.json({ success: true, order: publicOrder(order) })

      return fail(res, 409, 'This order has already been paid or closed.')
    }

    const { data: used } = await db().from(ORDERS).select('id').eq('tx_hash', txHash).maybeSingle()

    if (used) return fail(res, 409, 'That transaction was already used for another order.')

    const lookup = await chain.lookupTransaction(txHash, buyer)

    if (!lookup.found) {
      if (lookup.unreachable) return fail(res, 502, 'Could not reach the NEAR network. Please try again.')

      return void res.status(202).json({
        success: false,
        pending: true,
        error: 'The network has not finished that transaction yet. Trying again…',
      })
    }

    const verdict = checkPayment(lookup.tx, lookup.blockTimeMs, order)

    if (!verdict.ok) return fail(res, 422, verdict.reason)

    const now = new Date()

    const { data: updated, error: updateError } = await db()
      .from(ORDERS)
      .update({
        status: 'in_escrow',
        tx_hash: txHash,
        paid_at: now.toISOString(),
        release_after: new Date(now.getTime() + ESCROW_HOURS * 3_600_000).toISOString(),
      })
      .eq('id', order.id)
      .eq('status', 'awaiting_payment')
      .select('id')

    if (updateError || !updated || updated.length === 0) {
      return fail(res, 409, 'That transaction was already used for another order.')
    }

    for (const item of order.items) {
      const { data: product } = await db().from(PRODUCTS).select('quantity').eq('id', item.product_id).maybeSingle()

      if (product) {
        await db()
          .from(PRODUCTS)
          .update({ quantity: Math.max(0, Number(product.quantity) - item.quantity) })
          .eq('id', item.product_id)
      }
    }

    res.json({ success: true, order: publicOrder(await loadOrder(order.id)) })
  } catch (error) {
    console.error('Verify failed:', errorMessage(error, ''))
    fail(res, 500, 'Could not verify the payment. Please try again.')
  }
})

// Pays the seller (90%) and the marketplace (10%) out of escrow. Each payout is
// recorded as soon as it is sent, so a retry never pays anyone twice.
async function releaseOrder(order: any): Promise<boolean> {
  const fee = feeAccount()

  if (!escrowConfigured() || !fee) throw new Error('Escrow is not configured on the server.')

  const { data: claimed } = await db()
    .from(ORDERS)
    .update({ status: 'releasing' })
    .eq('id', order.id)
    .eq('status', 'in_escrow')
    .select('id')

  if (!claimed || claimed.length === 0) return false

  try {
    const split = splitFee(BigInt(order.total_yocto), Number(order.fee_bps ?? FEE_BPS))
    let sellerTx: string | null = order.seller_payout_tx ?? null
    let feeTx: string | null = order.fee_payout_tx ?? null

    if (!sellerTx) {
      sellerTx = await chain.sendFromEscrow(order.seller_account, split.seller)
      await db().from(ORDERS).update({ seller_payout_tx: sellerTx }).eq('id', order.id)
    }

    if (!feeTx && split.fee > 0n) {
      feeTx = await chain.sendFromEscrow(fee, split.fee)
      await db().from(ORDERS).update({ fee_payout_tx: feeTx }).eq('id', order.id)
    }

    await db()
      .from(ORDERS)
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('id', order.id)

    return true
  } catch (error) {
    console.error('Release failed:', errorMessage(error, ''))

    await db().from(ORDERS).update({ status: 'in_escrow' }).eq('id', order.id).eq('status', 'releasing')

    throw new Error('The payout could not be sent. Please try again in a moment.')
  }
}

async function releaseDueOrders(limit = 5) {
  const { data } = await db()
    .from(ORDERS)
    .select('*')
    .eq('status', 'in_escrow')
    .lte('release_after', new Date().toISOString())
    .limit(limit)

  for (const order of data ?? []) {
    try {
      await releaseOrder(order)
    } catch {
      // logged inside; the next call tries again
    }
  }
}

// Seller marks the item as sent. The buyer's window now runs from here (once).
app.post('/orders/:orderId/ship', async (req: Request, res: Response) => {
  try {
    const seller = String(req.body?.sellerAccount ?? '').trim()
    const now = new Date()

    const { data, error } = await db()
      .from(ORDERS)
      .update({
        shipped_at: now.toISOString(),
        release_after: new Date(now.getTime() + ESCROW_HOURS * 3_600_000).toISOString(),
      })
      .eq('id', req.params.orderId)
      .eq('seller_account', seller)
      .eq('status', 'in_escrow')
      .is('shipped_at', null)
      .select('id')

    if (error) throw new Error('Could not update the order.')
    if (!data || data.length === 0) return fail(res, 409, 'This order cannot be marked as shipped.')

    res.json({ success: true, order: publicOrder(await loadOrder(String(req.params.orderId))) })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not update the order.'))
  }
})

// Buyer is happy: pay the seller now instead of waiting for the window.
app.post('/orders/:orderId/confirm', async (req: Request, res: Response) => {
  try {
    const buyer = String(req.body?.buyerAccount ?? '').trim()
    const order = await loadOrder(String(req.params.orderId))

    if (!order || order.buyer_account !== buyer) return fail(res, 404, 'Order not found.')
    if (order.status !== 'in_escrow') return fail(res, 409, 'This order is not waiting in escrow.')

    await releaseOrder(order)

    res.json({ success: true, order: publicOrder(await loadOrder(order.id)) })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not release the payment.'))
  }
})

// Buyer opens a dispute inside the window: the money stays locked.
app.post('/orders/:orderId/dispute', async (req: Request, res: Response) => {
  try {
    const buyer = String(req.body?.buyerAccount ?? '').trim()
    const reason = String(req.body?.reason ?? '').trim().slice(0, 1000)

    if (reason.length < 10) return fail(res, 400, 'Please describe the problem (at least 10 characters).')

    const { data, error } = await db()
      .from(ORDERS)
      .update({ status: 'disputed', dispute_reason: reason, disputed_at: new Date().toISOString() })
      .eq('id', req.params.orderId)
      .eq('buyer_account', buyer)
      .eq('status', 'in_escrow')
      .gt('release_after', new Date().toISOString())
      .select('id')

    if (error) throw new Error('Could not open the dispute.')
    if (!data || data.length === 0) return fail(res, 409, 'The dispute window is closed or the order is not in escrow.')

    res.json({ success: true, order: publicOrder(await loadOrder(String(req.params.orderId))) })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not open the dispute.'))
  }
})

app.post('/orders/:orderId/cancel', async (req: Request, res: Response) => {
  try {
    const buyer = String(req.body?.buyerAccount ?? '').trim()

    const { data, error } = await db()
      .from(ORDERS)
      .update({ status: 'cancelled' })
      .eq('id', req.params.orderId)
      .eq('buyer_account', buyer)
      .eq('status', 'awaiting_payment')
      .select('id')

    if (error) throw new Error('Could not cancel the order.')
    if (!data || data.length === 0) return fail(res, 409, 'This order cannot be cancelled.')

    res.json({ success: true })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not cancel the order.'))
  }
})

// Admin decision on a disputed order. Protected by the ADMIN_TOKEN variable.
app.post('/orders/:orderId/resolve', async (req: Request, res: Response) => {
  try {
    const token = process.env.ADMIN_TOKEN

    if (!token || req.get('x-admin-token') !== token) return fail(res, 401, 'Not allowed.')

    const action = req.body?.action
    const order = await loadOrder(String(req.params.orderId))

    if (!order || order.status !== 'disputed') return fail(res, 409, 'This order is not in dispute.')

    if (action === 'release') {
      await db().from(ORDERS).update({ status: 'in_escrow' }).eq('id', order.id)
      await releaseOrder({ ...order, status: 'in_escrow' })
    } else if (action === 'refund') {
      const { data: claimed } = await db()
        .from(ORDERS)
        .update({ status: 'refunding' })
        .eq('id', order.id)
        .eq('status', 'disputed')
        .select('id')

      if (!claimed || claimed.length === 0) return fail(res, 409, 'This order is already being handled.')

      try {
        const refundTx = await chain.sendFromEscrow(order.buyer_account, BigInt(order.total_yocto))

        await db().from(ORDERS).update({ status: 'refunded', refund_tx: refundTx }).eq('id', order.id)

        for (const item of order.items) {
          const { data: product } = await db().from(PRODUCTS).select('quantity').eq('id', item.product_id).maybeSingle()

          if (product) {
            await db()
              .from(PRODUCTS)
              .update({ quantity: Number(product.quantity) + item.quantity })
              .eq('id', item.product_id)
          }
        }
      } catch (error) {
        await db().from(ORDERS).update({ status: 'disputed' }).eq('id', order.id)
        throw error
      }
    } else {
      return fail(res, 400, 'action must be "release" or "refund".')
    }

    res.json({ success: true, order: publicOrder(await loadOrder(order.id)) })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not resolve the dispute.'))
  }
})

// Pays out every order whose window has passed. Safe for anyone to call.
app.post('/orders/release-due', async (_req, res) => {
  try {
    await releaseDueOrders(10)
    res.json({ success: true })
  } catch {
    fail(res, 500, 'Could not process due orders.')
  }
})

// Orders for an account: ?account=...&role=buyer (default) or role=seller.
app.get('/orders', async (req: Request, res: Response) => {
  try {
    const account = String(req.query.account ?? '').trim()

    if (!isAccountId(account)) return fail(res, 400, 'A valid account is required.')

    const isSeller = req.query.role === 'seller'

    if (escrowConfigured()) await releaseDueOrders(3)

    let query = db()
      .from(ORDERS)
      .select('*')
      .eq(isSeller ? 'seller_account' : 'buyer_account', account)
      .order('created_at', { ascending: false })
      .limit(50)

    if (isSeller) query = query.neq('status', 'awaiting_payment').neq('status', 'cancelled')

    const { data, error } = await query

    if (error) throw new Error('Could not load orders.')

    const rows = data ?? []
    const ids = rows.map((row: any) => row.id)
    const { data: items } = ids.length ? await db().from(ITEMS).select('*').in('order_id', ids) : { data: [] as any[] }

    res.set('Cache-Control', 'no-store')
    res.json({
      success: true,
      orders: rows.map((row: any) =>
        publicOrder({ ...row, items: (items ?? []).filter((item: any) => item.order_id === row.id) }),
      ),
    })
  } catch (error) {
    fail(res, 500, errorMessage(error, 'Could not load your orders.'))
  }
})

registerSocial(app, { db, fail, errorMessage, upload, publicProduct, bucket: BUCKET })

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

const port = Number(process.env.PORT ?? 4000)

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Cartel API on :${port} (${NEAR_NETWORK})`))
}

export default app
