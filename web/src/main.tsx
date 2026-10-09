import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './app.tsx'
import { needReload, offlineReady, UpdateToast } from './components/UpdateToast'
import { startDataLoading } from './state/data'
import { startUrlSync } from './state/filters'

startUrlSync()
startDataLoading()
render(<><App /><UpdateToast /></>, document.getElementById('app')!)

// autoUpdate: the new SW activates on its own. A page that was already controlled by an older SW reloads itself once
// the new one takes over (a stale shell would otherwise keep running old code against new data), and we also poll for
// updates every 30 minutes so a long-lived installed app does not stay old.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload() }
  })
}
registerSW({
  immediate: true,
  onRegisteredSW: (_url, reg) => { if (reg) setInterval(() => reg.update().catch(() => undefined), 30 * 60 * 1000) },
  onNeedRefresh: () => { needReload.value = true },
  onOfflineReady: () => {
    offlineReady.value = true
    setTimeout(() => (offlineReady.value = false), 4000)
  },
})
