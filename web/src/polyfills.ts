import { Buffer } from 'buffer'

// Some wallet libraries expect Node's Buffer to exist in the browser.
;(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer
