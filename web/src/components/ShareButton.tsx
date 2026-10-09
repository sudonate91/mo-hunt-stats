/** Share menu for a chart/fact <figure id=target>: save/share as PNG, copy link. share.ts is loaded on first use. */
import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from './Icon'

const loadShare = () => import('../lib/share')

export function ShareButton({ target, label = 'Share' }: { target: string; label?: string }) {
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null) // fixed position: escapes overflow clipping
  const [msg, setMsg] = useState('')
  const btn = useRef<HTMLButtonElement>(null)

  // Escape closes the menu and returns focus to the button.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(null)
      btn.current?.focus()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [!!open])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const image = async () => {
    setOpen(null)
    setMsg('Rendering…')
    try {
      const r = await (await loadShare()).shareFigure(target)
      flash(r === 'downloaded' ? 'Image saved' : r === 'shared' ? 'Shared' : '')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not share')
    }
  }
  const link = async () => {
    setOpen(null)
    const ok = await (await loadShare()).copyLink()
    flash(ok ? 'Link copied' : 'Copy failed')
  }

  return (
    <span class="relative inline-flex items-center" data-share-ignore>
      {msg && <span role="status" class="text-[11px] text-fg-3 mr-1 whitespace-nowrap">{msg}</span>}
      <button ref={btn} type="button" class="tap inline-flex items-center justify-center text-fg-3 hover:text-fg rounded-lg"
        aria-label={label} aria-haspopup="menu" aria-expanded={!!open} onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setOpen(open ? null : { top: r.bottom + 4, right: innerWidth - r.right })
        }}>
        <Icon name="share" size={18} />
      </button>
      {open && (
        <>
          <div class="fixed inset-0 z-20" onClick={() => setOpen(null)} />
          <div role="menu" style={{ top: `${open.top}px`, right: `${open.right}px` }} class="fixed z-30 w-44 rounded-lg border border-line bg-bg-3 shadow-xl py-1">
            <button type="button" role="menuitem" class="w-full text-left px-3 text-sm hover:bg-bg-2" onClick={image}>
              {matchMedia('(pointer: coarse)').matches ? 'Share as image' : 'Save as PNG'}
            </button>
            <button type="button" role="menuitem" class="w-full text-left px-3 text-sm hover:bg-bg-2" onClick={link}>
              Copy link
            </button>
          </div>
        </>
      )}
    </span>
  )
}
