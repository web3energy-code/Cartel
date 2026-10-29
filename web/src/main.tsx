import './polyfills'
import { createRoot } from 'react-dom/client'
import { WalletProvider } from './wallet'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <WalletProvider>
    <App />
  </WalletProvider>,
)
