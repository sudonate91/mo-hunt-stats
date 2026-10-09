/** Service-worker status toast: "Update available — reload" after a new SW activates, and a one-time "ready offline". */
import { signal } from '@preact/signals'

export const needReload = signal(false)
export const offlineReady = signal(false)

export function UpdateToast() {
  if (!needReload.value && !offlineReady.value) return null
  const update = needReload.value
  return (
    <div role="status" aria-live="polite"
      class="fixed z-50 left-4 right-4 bottom-[calc(4.5rem+var(--safe-bottom))] lg:bottom-4 lg:left-auto lg:w-96 flex items-center gap-3 rounded-xl border border-line bg-bg-3 px-4 py-2 shadow-2xl text-sm">
      <span class="flex-1">{update ? 'Update available.' : 'Ready to work offline.'}</span>
      {update && (
        <button type="button" class="tap px-3 rounded-lg bg-blaze text-black font-semibold" onClick={() => location.reload()}>Reload</button>
      )}
      <button type="button" class="tap text-fg-3" aria-label="Dismiss" onClick={() => { needReload.value = false; offlineReady.value = false }}>✕</button>
    </div>
  )
}
