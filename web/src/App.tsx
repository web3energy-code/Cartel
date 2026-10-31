import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Home, MessageCircle, Minus, Package, Plus, ShieldCheck, ShoppingBag, SlidersHorizontal, Store, Tag, User } from 'lucide-react'
import { api, nameOf, near, shortAccount } from './api'
import type { Config, Product, Profile as ProfileData } from './api'
import { useWallet } from './wallet'
import Sell from './Sell'
import Checkout from './Checkout'
import Inbox from './Inbox'
import Admin from './Admin'
import ProfilePage from './Profile'
import Seller from './Seller'
import { Avatar } from './ui'
import { AlertsPanel, Bell, useAlerts } from './Notifications'

type Page = 'market' | 'product' | 'sell' | 'cart' | 'seller' | 'inbox' | 'me'

const CART_KEY = 'cartel-cart'
const RETURN_KEY = 'cartel-returned-tx'

function loadCart(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '{}')
  } catch {
    return {}
  }
}

export default function App() {
  const { accountId, connect, disconnect, ready } = useWallet()

  const [page, setPage] = useState<Page>('market')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [config, setConfig] = useState<Config | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [cart, setCart] = useState<Record<string, number>>(loadCart)
  const [notice, setNotice] = useState('')
  const [returnedTx, setReturnedTx] = useState('')
  const [profiles, setProfiles] = useState<Record<string, ProfileData>>({})
  const [sellerAccount, setSellerAccount] = useState('')
  const [chatWith, setChatWith] = useState('')
  const [chatProduct, setChatProduct] = useState('')
  const [unread, setUnread] = useState(0)
  const [cameFrom, setCameFrom] = useState<Page>('market')
  const [sort, setSort] = useState('new')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [condition, setCondition] = useState('Any')
  const [showFilters, setShowFilters] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [adminMode, setAdminMode] = useState(window.location.hash === '#admin-tools')

  useEffect(() => {
    const onHash = () => setAdminMode(window.location.hash === '#admin-tools')

    window.addEventListener('hashchange', onHash)

    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart))
    } catch {
      // storage can be blocked in some in-app browsers
    }
  }, [cart])

  // Coming back from a wallet that left the page to approve a payment.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hash = params.get('transactionHashes')

    if (hash) {
      setReturnedTx(hash.split(',')[0])
      setPage('cart')
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line
  }, [])

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3200)
  }, [])

  const { alerts, unread: unreadAlerts, markAllRead } = useAlerts(accountId, flash)

  const loadProducts = useCallback(async () => {
    try {
      const result = await api<{ products: Product[] }>('/products')

      setProducts(result.products)
      setLoadError('')

      const sellers = Array.from(new Set(result.products.map((product) => product.sellerAccount))).slice(0, 50)

      if (sellers.length) {
        api<{ profiles: Record<string, ProfileData> }>(`/profiles?accounts=${sellers.map(encodeURIComponent).join(',')}`)
          .then((loaded) => setProfiles((previous) => ({ ...previous, ...loaded.profiles })))
          .catch(() => undefined)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load products.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProducts()
    api<Config & { success: boolean }>('/config').then(setConfig).catch(() => undefined)

    const timer = window.setInterval(() => void loadProducts(), 20_000)

    return () => window.clearInterval(timer)
  }, [loadProducts])

  // Keep the unread badge fresh while connected.
  useEffect(() => {
    if (!accountId) {
      setUnread(0)
      return
    }

    const check = () =>
      api<{ unread: number }>(`/conversations?account=${encodeURIComponent(accountId)}`)
        .then((result) => setUnread(result.unread))
        .catch(() => undefined)

    void check()

    const timer = window.setInterval(() => void check(), 20_000)

    return () => window.clearInterval(timer)
  }, [accountId])

  const categories = useMemo(() => ['All', ...(config?.categories ?? ['Electronics', 'Fashion', 'Beauty', 'Home', 'Accessories', 'Gaming', 'Other'])], [config])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()

    return products.filter((product) => {
      const matchesCategory = category === 'All' || product.category === category
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.sellerAccount.includes(query) ||
        product.location.toLowerCase().includes(query)

      const price = Number(product.priceNear)
      const matchesPrice = (!minPrice || price >= Number(minPrice)) && (!maxPrice || price <= Number(maxPrice))
      const matchesCondition = condition === 'Any' || product.condition === condition

      return matchesCategory && matchesSearch && matchesPrice && matchesCondition
    })
    .sort((a, b) =>
      sort === 'low'
        ? Number(a.priceNear) - Number(b.priceNear)
        : sort === 'high'
          ? Number(b.priceNear) - Number(a.priceNear)
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [products, search, category, sort, minPrice, maxPrice, condition])

  const activeFilters = (sort !== 'new' ? 1 : 0) + (minPrice || maxPrice ? 1 : 0) + (condition !== 'Any' ? 1 : 0)

  const selected = products.find((product) => product.id === selectedId) ?? null
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)

  function open(next: Page) {
    if (next !== 'seller' && next !== 'inbox') setCameFrom(next === 'product' ? 'market' : page)
    setPage(next)
    window.scrollTo({ top: 0 })
  }

  function openProduct(id: string) {
    setSelectedId(id)
    open('product')
  }

  function openSeller(account: string) {
    setSellerAccount(account)
    setCameFrom(page === 'seller' ? cameFrom : page)
    setPage('seller')
    window.scrollTo({ top: 0 })
  }

  function openChat(account: string, productName = '') {
    setChatWith(account)
    setChatProduct(productName)
    setCameFrom(page === 'inbox' ? cameFrom : page)
    setPage('inbox')
    window.scrollTo({ top: 0 })
  }

  function addToCart(product: Product, amount = 1) {
    if (accountId && product.sellerAccount === accountId) {
      flash('You cannot buy your own listing.')
      return
    }

    const current = cart[product.id] || 0

    if (current + amount > product.quantity) {
      flash('You have reached the available quantity.')
      return
    }

    setCart((previous) => ({ ...previous, [product.id]: current + amount }))
    flash(`${product.name} added to your cart.`)
  }

  function changeQuantity(id: string, amount: number) {
    setCart((previous) => {
      const next = { ...previous }
      const quantity = (next[id] || 0) + amount

      if (quantity <= 0) delete next[id]
      else next[id] = quantity

      return next
    })
  }

  function removeFromCart(id: string) {
    setCart((previous) => {
      const next = { ...previous }

      delete next[id]

      return next
    })
  }

  const nav: Array<{ key: Page; label: string; icon: JSX.Element }> = [
    { key: 'market', label: 'Market', icon: <Home size={20} /> },
    { key: 'sell', label: 'Sell', icon: <Tag size={20} /> },
    { key: 'cart', label: 'Cart', icon: <ShoppingBag size={20} /> },
    { key: 'inbox', label: 'Inbox', icon: <MessageCircle size={20} /> },
    { key: 'me', label: 'Me', icon: <User size={20} /> },
  ]

  return (
    <>
      <header className="c-top">
        <button className="c-logo" onClick={() => open('market')} aria-label="Cartel home">
          <i /> CARTEL
        </button>

        <nav className="c-topnav">
          {nav.map((item) => (
            <button
              key={item.key}
              className={page === item.key || (item.key === 'market' && page === 'product') ? 'on' : ''}
              onClick={() => (item.key === 'inbox' ? openChat('') : open(item.key))}
            >
              {item.label}
              {item.key === 'cart' && cartCount > 0 ? ` (${cartCount})` : ''}
              {item.key === 'inbox' && unread > 0 ? ` (${unread})` : ''}
            </button>
          ))}
        </nav>

        {accountId && <Bell unread={unreadAlerts} onClick={() => { setShowAlerts(true); markAllRead() }} />}

        {accountId ? (
          <button className="c-wallet on" onClick={() => void disconnect()} title="Tap to disconnect">
            {shortAccount(accountId)}
          </button>
        ) : (
          <button className="c-wallet" onClick={connect} disabled={!ready}>
            {ready ? 'Connect wallet' : 'Loading…'}
          </button>
        )}
      </header>

      <main className="c-main">
        {adminMode && <Admin />}

        {!adminMode && page === 'market' && (
          <>
            <section className="c-hero">
              <h1>Buy and sell on NEAR.</h1>
              <p>Every payment sits in escrow until your order arrives.</p>
            </section>

            <input
              className="c-search"
              type="search"
              placeholder="Search products, categories, sellers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="c-filterbar">
              <button className={'c-btn ghost small' + (showFilters ? ' on' : '')} onClick={() => setShowFilters((value) => !value)}>
                <SlidersHorizontal size={15} /> Filters{activeFilters ? ` (${activeFilters})` : ''}
              </button>
              <span className="c-sub">
                {visible.length} {visible.length === 1 ? 'item' : 'items'}
              </span>
              {activeFilters > 0 && (
                <button
                  className="c-link"
                  onClick={() => {
                    setSort('new')
                    setMinPrice('')
                    setMaxPrice('')
                    setCondition('Any')
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {showFilters && (
              <div className="c-box c-filters">
                <div className="c-field">
                  <label htmlFor="sort">Sort by</label>
                  <select id="sort" value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value="new">Newest</option>
                    <option value="low">Price: low to high</option>
                    <option value="high">Price: high to low</option>
                  </select>
                </div>
                <div className="c-two">
                  <div className="c-field">
                    <label htmlFor="min">Min price (NEAR)</label>
                    <input id="min" inputMode="decimal" value={minPrice} onChange={(event) => setMinPrice(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
                  </div>
                  <div className="c-field">
                    <label htmlFor="max">Max price (NEAR)</label>
                    <input id="max" inputMode="decimal" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="Any" />
                  </div>
                </div>
                <div className="c-chips" style={{ margin: 0 }}>
                  {['Any', 'New', 'Like new', 'Used'].map((name) => (
                    <button key={name} className={'c-chip' + (condition === name ? ' on' : '')} onClick={() => setCondition(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="c-chips">
              {categories.map((name) => (
                <button key={name} className={'c-chip' + (category === name ? ' on' : '')} onClick={() => setCategory(name)}>
                  {name}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="c-empty">Loading listings…</div>
            ) : loadError ? (
              <div className="c-empty">
                <b>{loadError}</b>
                <button className="c-btn" onClick={() => void loadProducts()}>
                  Try again
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="c-empty">
                <Store size={34} />
                <b>{products.length === 0 ? 'No listings yet' : 'Nothing matches your search'}</b>
                <span>{products.length === 0 ? 'Be the first to list something on Cartel.' : 'Try another word or category.'}</span>
                {products.length === 0 && (
                  <button className="c-btn signal" onClick={() => open('sell')}>
                    Sell something
                  </button>
                )}
              </div>
            ) : (
              <div className="c-grid">
                {visible.map((product) => (
                  <button key={product.id} className="c-card" onClick={() => openProduct(product.id)}>
                    {product.images[0] ? (
                      <img src={product.images[0]} alt={product.name} loading="lazy" />
                    ) : (
                      <div className="c-noimg">
                        <Package size={28} />
                      </div>
                    )}

                    <div className="c-card-body">
                      <span className="c-card-name">{product.name}</span>
                      <span className="c-price">
                        {Number(product.priceNear).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                        <small>NEAR</small>
                      </span>
                      <span className="c-sub">
                        {product.location ? `${product.location} · ` : ''}
                        {nameOf(profiles[product.sellerAccount], product.sellerAccount)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {!adminMode && page === 'product' && (
          <>
            <button className="c-back" onClick={() => open('market')}>
              <ArrowLeft size={18} /> Back to market
            </button>

            {!selected ? (
              <div className="c-empty">This listing is no longer available.</div>
            ) : (
              <ProductView
                product={selected}
                sellerProfile={profiles[selected.sellerAccount]}
                onSeller={() => openSeller(selected.sellerAccount)}
                onMessage={() => (accountId ? openChat(selected.sellerAccount, selected.name) : connect())}
                others={products.filter((product) => product.sellerAccount === selected.sellerAccount && product.id !== selected.id)}
                inCart={cart[selected.id] || 0}
                mine={!!accountId && accountId === selected.sellerAccount}
                escrowHours={config?.escrowHours ?? 24}
                onAdd={(amount) => addToCart(selected, amount)}
                onBuyNow={() => {
                  addToCart(selected, cart[selected.id] ? 0 : 1)
                  open('cart')
                }}
                onOpen={openProduct}
              />
            )}
          </>
        )}

        {!adminMode && page === 'seller' && (
          <Seller
            account={sellerAccount}
            onBack={() => open(cameFrom === 'seller' ? 'market' : cameFrom)}
            onMessage={(account) => openChat(account)}
            onOpenProduct={openProduct}
          />
        )}

        {!adminMode && page === 'inbox' && (
          <Inbox
            openWith={chatWith}
            productName={chatProduct}
            onClose={() => {
              setChatWith('')
              setChatProduct('')
            }}
            onViewSeller={openSeller}
            onUnread={setUnread}
          />
        )}

        {!adminMode && page === 'me' && (
          <ProfilePage
            onSaved={(saved) => setProfiles((previous) => ({ ...previous, [saved.account]: saved }))}
            onViewPublic={openSeller}
          />
        )}

        {!adminMode && page === 'sell' && (
          <Sell
            categories={config?.categories ?? []}
            onPublished={() => {
              void loadProducts()
              flash('Your listing is live.')
              open('market')
            }}
            onChanged={() => void loadProducts()}
            products={products}
          />
        )}

        {!adminMode && page === 'cart' && (
          <Checkout
            products={products}
            cart={cart}
            config={config}
            returnedTx={returnedTx}
            onReturnedTxHandled={() => {
              setReturnedTx('')
              try {
                localStorage.removeItem(RETURN_KEY)
              } catch {
                // ignore
              }
            }}
            onChangeQuantity={changeQuantity}
            onRemove={removeFromCart}
            onItemsPaid={(ids) =>
              setCart((previous) => {
                const next = { ...previous }

                ids.forEach((id) => delete next[id])

                return next
              })
            }
            onBrowse={() => open('market')}
            onOpenProduct={openProduct}
            onStockChanged={() => void loadProducts()}
          />
        )}
      </main>

      <nav className="c-bottom" aria-label="Main">
        {nav.map((item) => (
          <button
            key={item.key}
            className={page === item.key || (item.key === 'market' && page === 'product') ? 'on' : ''}
            onClick={() => (item.key === 'inbox' ? openChat('') : open(item.key))}
          >
            {item.icon}
            {item.label}
            {item.key === 'cart' && cartCount > 0 && <span className="c-dot">{cartCount}</span>}
            {item.key === 'inbox' && unread > 0 && <span className="c-dot">{unread}</span>}
          </button>
        ))}
      </nav>

      {showAlerts && (
        <AlertsPanel
          alerts={alerts}
          onClose={() => setShowAlerts(false)}
          onOpenOrders={() => {
            setShowAlerts(false)
            open('cart')
          }}
        />
      )}

      {notice && <div className="c-toast">{notice}</div>}
    </>
  )
}

function ProductView({
  product,
  sellerProfile,
  onSeller,
  onMessage,
  others,
  inCart,
  mine,
  escrowHours,
  onAdd,
  onBuyNow,
  onOpen,
}: {
  product: Product
  sellerProfile?: ProfileData
  onSeller: () => void
  onMessage: () => void
  others: Product[]
  inCart: number
  mine: boolean
  escrowHours: number
  onAdd: (amount: number) => void
  onBuyNow: () => void
  onOpen: (id: string) => void
}) {
  const [image, setImage] = useState(0)
  const [amount, setAmount] = useState(1)
  const left = product.quantity - inCart

  return (
    <>
      <div className="c-product">
        <div className="c-gallery">
          {product.images[image] ? (
            <img src={product.images[image]} alt={product.name} />
          ) : (
            <div className="c-noimg" style={{ aspectRatio: '1/1', borderRadius: 20 }}>
              <Package size={40} />
            </div>
          )}

          {product.images.length > 1 && (
            <div className="c-thumbs">
              {product.images.map((src, index) => (
                <img key={src} src={src} alt="" className={index === image ? 'on' : ''} onClick={() => setImage(index)} />
              ))}
            </div>
          )}
        </div>

        <div className="c-info">
          <h1>{product.name}</h1>

          <div className="c-bigprice">
            {Number(product.priceNear).toLocaleString('en-US', { maximumFractionDigits: 6 })} <small>NEAR</small>
          </div>

          <div className="c-tags">
            <span className="c-tag">{product.category}</span>
            <span className="c-tag">{product.condition}</span>
            {product.location && <span className="c-tag">{product.location}</span>}
            <span className="c-tag">{product.quantity} in stock</span>
            <span className="c-tag">{Number(product.deliveryFeeNear) > 0 ? `Includes ${near(product.deliveryFeeNear)} delivery` : 'Delivery arranged with seller'}</span>
          </div>

          <p className="c-desc">{product.description}</p>

          <div className="c-box">
            <div className="c-sub" style={{ marginBottom: 8 }}>Sold by</div>
            <button className="c-person" onClick={onSeller}>
              <Avatar profile={sellerProfile} account={product.sellerAccount} size={46} />
              <span>
                <b>{nameOf(sellerProfile, product.sellerAccount)}</b>
                <span className="c-sub">
                  {sellerProfile?.username ? `@${sellerProfile.username} · ` : ''}
                  View seller page
                </span>
              </span>
            </button>
            {!mine && (
              <button className="c-btn ghost full" style={{ marginTop: 12 }} onClick={onMessage}>
                <MessageCircle size={17} /> Message seller
              </button>
            )}
          </div>

          {mine ? (
            <div className="c-warnbox">This is your listing. Manage it from the Sell tab.</div>
          ) : (
            <>
              <div className="c-qty" style={{ marginBottom: 12 }}>
                <button onClick={() => setAmount((value) => Math.max(1, value - 1))} aria-label="Less">
                  <Minus size={14} />
                </button>
                <b>{amount}</b>
                <button onClick={() => setAmount((value) => Math.min(Math.max(1, left), value + 1))} aria-label="More" disabled={amount >= left}>
                  <Plus size={14} />
                </button>
                {inCart > 0 && <span className="c-sub">{inCart} already in your cart</span>}
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <button className="c-btn signal full" disabled={left < 1} onClick={() => onAdd(amount)}>
                  <ShoppingBag size={18} /> {left < 1 ? 'All units are in your cart' : 'Add to cart'}
                </button>
                <button className="c-btn full" onClick={onBuyNow}>
                  Buy now
                </button>
              </div>
            </>
          )}

          <div className="c-box c-escrow">
            <ShieldCheck size={18} />
            <span>
              Escrow protected. Your NEAR is held safely and only released to the seller after you confirm delivery, or
              {` ${escrowHours} hours `}after payment with no dispute.
            </span>
          </div>
        </div>
      </div>

      {others.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>More from this seller</h2>
          <div className="c-grid">
            {others.slice(0, 8).map((item) => (
              <button key={item.id} className="c-card" onClick={() => onOpen(item.id)}>
                {item.images[0] ? <img src={item.images[0]} alt={item.name} /> : <div className="c-noimg"><Package size={28} /></div>}
                <div className="c-card-body">
                  <span className="c-card-name">{item.name}</span>
                  <span className="c-price">
                    {near(item.priceNear).replace(' NEAR', '')}
                    <small>NEAR</small>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
