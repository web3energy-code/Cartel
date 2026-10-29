import type { Express, Request, Response } from 'express'
import type { Multer } from 'multer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { isAccountId } from './near.js'

// Profiles, seller pages, reviews and messages.
// Like the rest of Cartel there are no wallet signatures: the account id comes from the
// connected wallet in the browser. Money safety never depends on these routes.

interface Deps {
  db: () => SupabaseClient
  fail: (res: Response, status: number, message: string) => void
  errorMessage: (error: unknown, fallback: string) => string
  upload: Multer
  publicProduct: (row: any) => any
  bucket: string
}

const PROFILES = 'cartel_profiles'
const REVIEWS = 'cartel_reviews'
const MESSAGES = 'cartel_messages'
const ORDERS = 'cartel_orders'
const PRODUCTS = 'cartel_products'

export function publicProfile(account: string, row: any | null) {
  return {
    account,
    username: row?.username ?? null,
    displayName: row?.display_name ?? null,
    bio: row?.bio ?? '',
    location: row?.location ?? '',
    avatarUrl: row?.avatar_url ?? null,
    createdAt: row?.created_at ?? null,
  }
}

function publicReview(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
    sellerAccount: row.seller_account,
    buyerAccount: row.buyer_account,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  }
}

function publicMessage(row: any) {
  return {
    id: row.id,
    from: row.sender,
    to: row.recipient,
    body: row.body,
    productId: row.product_id ?? null,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  }
}

export function summarize(reviews: any[]) {
  const count = reviews.length
  const total = reviews.reduce((sum, review) => sum + Number(review.rating), 0)

  return { reviewCount: count, rating: count ? Math.round((total / count) * 10) / 10 : 0 }
}

export function registerSocial(app: Express, deps: Deps) {
  const { db, fail, errorMessage, upload, publicProduct, bucket } = deps

  async function profilesFor(accounts: string[]) {
    const unique = Array.from(new Set(accounts.filter(isAccountId))).slice(0, 50)
    const map: Record<string, ReturnType<typeof publicProfile>> = {}

    if (unique.length === 0) return map

    const { data } = await db().from(PROFILES).select('*').in('account', unique)

    for (const account of unique) {
      map[account] = publicProfile(account, (data ?? []).find((row: any) => row.account === account) ?? null)
    }

    return map
  }

  // Several profiles at once (names and photos for lists).
  app.get('/profiles', async (req: Request, res: Response) => {
    try {
      const accounts = String(req.query.accounts ?? '').split(',').map((item) => item.trim())

      res.json({ success: true, profiles: await profilesFor(accounts) })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not load profiles.'))
    }
  })

  app.get('/profiles/:account', async (req: Request, res: Response) => {
    try {
      const account = String(req.params.account)

      if (!isAccountId(account)) return fail(res, 400, 'Invalid account.')

      const profiles = await profilesFor([account])

      res.json({ success: true, profile: profiles[account] })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not load the profile.'))
    }
  })

  // Create or update your own profile.
  app.post('/profiles', upload.single('avatar'), async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {}
      const account = String(body.account ?? '').trim()
      const username = String(body.username ?? '').trim().toLowerCase()
      const displayName = String(body.displayName ?? '').trim()
      const bio = String(body.bio ?? '').trim()
      const location = String(body.location ?? '').trim()
      const file = req.file

      if (!isAccountId(account)) return fail(res, 400, 'Connect your NEAR wallet first.')
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        return fail(res, 400, 'Username must be 3–20 letters, numbers or underscores.')
      }
      if (displayName.length > 40) return fail(res, 400, 'Display name is too long (40 characters max).')
      if (bio.length > 300) return fail(res, 400, 'Bio is too long (300 characters max).')
      if (location.length > 60) return fail(res, 400, 'Location is too long (60 characters max).')

      const { data: taken } = await db().from(PROFILES).select('account').eq('username', username).neq('account', account).maybeSingle()

      if (taken) return fail(res, 409, 'That username is already taken.')

      const update: Record<string, unknown> = {
        account,
        username,
        display_name: displayName || null,
        bio,
        location,
      }

      if (file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return fail(res, 400, 'Photo must be JPG, PNG or WebP.')

        const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg'
        const path = `avatars/${account}/${randomUUID()}.${extension}`

        const { error: uploadError } = await db().storage.from(bucket).upload(path, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        })

        if (uploadError) throw new Error('Could not upload your photo. Please try again.')

        update.avatar_url = db().storage.from(bucket).getPublicUrl(path).data.publicUrl
      }

      const { data, error } = await db().from(PROFILES).upsert(update, { onConflict: 'account' }).select('*').single()

      if (error) {
        if (String(error.message).includes('username')) return fail(res, 409, 'That username is already taken.')
        throw new Error('Could not save your profile.')
      }

      res.json({ success: true, profile: publicProfile(account, data) })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not save your profile.'))
    }
  })

  // A public seller page: profile, rating, listings and reviews.
  app.get('/sellers/:account', async (req: Request, res: Response) => {
    try {
      const account = String(req.params.account)

      if (!isAccountId(account)) return fail(res, 400, 'Invalid account.')

      const [profiles, productResult, reviewResult, salesResult] = await Promise.all([
        profilesFor([account]),
        db().from(PRODUCTS).select('*').eq('seller_account', account).eq('status', 'published').gt('quantity', 0).order('created_at', { ascending: false }).limit(60),
        db().from(REVIEWS).select('*').eq('seller_account', account).order('created_at', { ascending: false }).limit(100),
        db().from(ORDERS).select('id').eq('seller_account', account).eq('status', 'released').limit(1000),
      ])

      const reviews = reviewResult.data ?? []
      const reviewers = await profilesFor(reviews.map((review: any) => review.buyer_account))

      res.json({
        success: true,
        profile: profiles[account],
        stats: { ...summarize(reviews), completedSales: (salesResult.data ?? []).length },
        products: (productResult.data ?? []).map(publicProduct),
        reviews: reviews.map((review: any) => ({ ...publicReview(review), reviewer: reviewers[review.buyer_account] })),
      })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not load the seller page.'))
    }
  })

  // Rate a seller after an order is completed. One review per order, buyer only.
  app.post('/reviews', async (req: Request, res: Response) => {
    try {
      const buyer = String(req.body?.buyerAccount ?? '').trim()
      const orderId = String(req.body?.orderId ?? '').trim()
      const rating = Number(req.body?.rating)
      const comment = String(req.body?.comment ?? '').trim()

      if (!isAccountId(buyer)) return fail(res, 400, 'Connect your NEAR wallet first.')
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Choose a rating from 1 to 5 stars.')
      if (comment.length > 600) return fail(res, 400, 'Review is too long (600 characters max).')

      const { data: order } = await db().from(ORDERS).select('*').eq('id', orderId).maybeSingle()

      if (!order || order.buyer_account !== buyer) return fail(res, 404, 'Order not found.')
      if (order.status !== 'released') return fail(res, 409, 'You can review a seller once the order is completed.')

      const { data: existing } = await db().from(REVIEWS).select('id').eq('order_id', orderId).maybeSingle()

      if (existing) return fail(res, 409, 'You already reviewed this order.')

      const { data, error } = await db()
        .from(REVIEWS)
        .insert({ order_id: orderId, seller_account: order.seller_account, buyer_account: buyer, rating, comment })
        .select('*')
        .single()

      if (error || !data) throw new Error('Could not save your review.')

      res.status(201).json({ success: true, review: publicReview(data) })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not save your review.'))
    }
  })

  // Which of these orders has the buyer already reviewed?
  app.get('/reviews/mine', async (req: Request, res: Response) => {
    try {
      const buyer = String(req.query.account ?? '').trim()

      if (!isAccountId(buyer)) return fail(res, 400, 'Invalid account.')

      const { data } = await db().from(REVIEWS).select('order_id, rating').eq('buyer_account', buyer).limit(200)

      res.set('Cache-Control', 'no-store')
      res.json({ success: true, reviewed: (data ?? []).map((row: any) => ({ orderId: row.order_id, rating: row.rating })) })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not load your reviews.'))
    }
  })

  // Send a message.
  app.post('/messages', async (req: Request, res: Response) => {
    try {
      const from = String(req.body?.from ?? '').trim()
      const to = String(req.body?.to ?? '').trim()
      const body = String(req.body?.body ?? '').trim()
      const productId = req.body?.productId ? String(req.body.productId) : null

      if (!isAccountId(from)) return fail(res, 400, 'Connect your NEAR wallet first.')
      if (!isAccountId(to)) return fail(res, 400, 'Invalid recipient.')
      if (from === to) return fail(res, 400, 'You cannot message yourself.')
      if (body.length < 1 || body.length > 1000) return fail(res, 400, 'Messages must be 1–1000 characters.')

      const { data, error } = await db()
        .from(MESSAGES)
        .insert({ sender: from, recipient: to, body, product_id: productId })
        .select('*')
        .single()

      if (error || !data) throw new Error('Could not send your message.')

      res.status(201).json({ success: true, message: publicMessage(data) })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not send your message.'))
    }
  })

  // Your conversation list, newest first.
  app.get('/conversations', async (req: Request, res: Response) => {
    try {
      const account = String(req.query.account ?? '').trim()

      if (!isAccountId(account)) return fail(res, 400, 'Invalid account.')

      const { data, error } = await db()
        .from(MESSAGES)
        .select('*')
        .or(`sender.eq.${account},recipient.eq.${account}`)
        .order('created_at', { ascending: false })
        .limit(400)

      if (error) throw new Error('Could not load your messages.')

      const threads = new Map<string, { with: string; last: any; unread: number }>()

      for (const row of data ?? []) {
        const other = row.sender === account ? row.recipient : row.sender
        const thread = threads.get(other) ?? { with: other, last: row, unread: 0 }

        if (row.recipient === account && !row.read_at) thread.unread += 1
        threads.set(other, thread)
      }

      const list = Array.from(threads.values())
      const profiles = await profilesFor(list.map((thread) => thread.with))

      res.set('Cache-Control', 'no-store')
      res.json({
        success: true,
        conversations: list.map((thread) => ({
          with: thread.with,
          profile: profiles[thread.with],
          last: publicMessage(thread.last),
          unread: thread.unread,
        })),
        unread: list.reduce((sum, thread) => sum + thread.unread, 0),
      })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not load your messages.'))
    }
  })

  // One conversation. Opening it marks the other person's messages as read.
  app.get('/messages', async (req: Request, res: Response) => {
    try {
      const account = String(req.query.account ?? '').trim()
      const other = String(req.query.with ?? '').trim()

      if (!isAccountId(account) || !isAccountId(other)) return fail(res, 400, 'Invalid account.')

      const { data, error } = await db()
        .from(MESSAGES)
        .select('*')
        .or(`and(sender.eq.${account},recipient.eq.${other}),and(sender.eq.${other},recipient.eq.${account})`)
        .order('created_at', { ascending: true })
        .limit(300)

      if (error) throw new Error('Could not load the conversation.')

      await db().from(MESSAGES).update({ read_at: new Date().toISOString() }).eq('sender', other).eq('recipient', account).is('read_at', null)

      const profiles = await profilesFor([other])

      res.set('Cache-Control', 'no-store')
      res.json({ success: true, profile: profiles[other], messages: (data ?? []).map(publicMessage) })
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Could not load the conversation.'))
    }
  })
}
