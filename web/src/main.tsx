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

// autoUpdate: the new SW activates on its own; we ask before reloading the page out from under the user.
registerSW({
  immediate: true,
  onNeedReload: () => { needReload.value = true },
  onOfflineReady: () => {
    offlineReady.value = true
    setTimeout(() => (offlineReady.value = false), 4000)
  },
})
