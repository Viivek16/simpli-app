import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.tsx'
import { InstallPrompt } from './pwa/InstallPrompt'
import { initSpacetimeDB } from './spacetimedb'

// Open the SpacetimeDB WebSocket at module load — before React mounts and before the
// lazy cosmos chunk resolves — so the connect handshake + initial data subscription run
// in parallel with rendering instead of starting inside a post-mount effect. This is what
// removes the "dark cosmos, then galaxies pop in a few seconds later" gap.
initSpacetimeDB()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''}>
      <App />
      <InstallPrompt />
    </GoogleOAuthProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
