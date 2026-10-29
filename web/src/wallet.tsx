import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { setupWalletSelector } from '@near-wallet-selector/core'
import type { WalletSelector } from '@near-wallet-selector/core'
import { setupModal } from '@near-wallet-selector/modal-ui'
import type { WalletSelectorModal } from '@near-wallet-selector/modal-ui'
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet'
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet'
import { setupHereWallet } from '@near-wallet-selector/here-wallet'
import { actionCreators } from '@near-js/transactions'
import '@near-wallet-selector/modal-ui/styles.css'
import { NETWORK } from './api'

interface WalletValue {
  ready: boolean
  accountId: string
  connect: () => void
  disconnect: () => Promise<void>
  // Sends NEAR to an account. Returns the transaction hash, or null when the
  // wallet sent the browser away to approve it (the page comes back afterwards).
  sendNear: (receiverId: string, yocto: string) => Promise<string | null>
}

const WalletContext = createContext<WalletValue | null>(null)

export function useWallet(): WalletValue {
  const value = useContext(WalletContext)

  if (!value) throw new Error('useWallet must be used inside <WalletProvider>')

  return value
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const selectorRef = useRef<WalletSelector | null>(null)
  const modalRef = useRef<WalletSelectorModal | null>(null)
  const [ready, setReady] = useState(false)
  const [accountId, setAccountId] = useState('')

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    async function start() {
      try {
        const selector = await setupWalletSelector({
          network: NETWORK,
          modules: [setupMyNearWallet(), setupMeteorWallet(), setupHereWallet()],
        })

        if (cancelled) return

        selectorRef.current = selector
        modalRef.current = setupModal(selector, { theme: 'light' })

        const read = () => {
          const accounts = selector.store.getState().accounts
          const active = accounts.find((account) => account.active) ?? accounts[0]

          setAccountId(active ? active.accountId : '')
        }

        read()

        const subscription = selector.store.observable.subscribe(() => read())

        unsubscribe = () => subscription.unsubscribe()
      } catch (error) {
        console.error('Wallet setup failed', error)
      } finally {
        if (!cancelled) setReady(true)
      }
    }

    void start()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const connect = useCallback(() => {
    modalRef.current?.show()
  }, [])

  const disconnect = useCallback(async () => {
    const selector = selectorRef.current

    if (!selector) return

    try {
      const wallet = await selector.wallet()

      await wallet.signOut()
    } catch {
      // already signed out
    }

    setAccountId('')
  }, [])

  const sendNear = useCallback(
    async (receiverId: string, yocto: string) => {
      const selector = selectorRef.current

      if (!selector || !accountId) throw new Error('Connect your NEAR wallet first.')

      const wallet = await selector.wallet()

      const outcome: any = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId,
        actions: [actionCreators.transfer(BigInt(yocto))],
      })

      return outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? null
    },
    [accountId],
  )

  const value = useMemo(
    () => ({ ready, accountId, connect, disconnect, sendNear }),
    [ready, accountId, connect, disconnect, sendNear],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
