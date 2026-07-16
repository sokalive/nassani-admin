import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import HomeLogoFormModal from '../components/HomeLogoFormModal'
import Topbar from '../components/Topbar'
import { useToast } from '../context/ToastContext.jsx'
import {
  deleteHomeLogo,
  getHomeLogosManage,
  postHomeLogo,
  postHomeLogosReorder,
  putHomeLogo,
  syncStreamUrl,
} from '../lib/api'
import { shouldReplaceRows } from '../lib/adminDataGuards'
import { readAdminSnapshot, writeAdminSnapshot } from '../lib/adminSnapshotCache'

function normalizeLogo(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    isActive: row.isActive !== false && row.active !== false,
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0) || 0,
    image: row.image ?? row.imageUrl ?? row.image_url ?? '',
  }
}

function reorderById(list, fromId, toId) {
  const next = [...list]
  const fi = next.findIndex((x) => String(x.id) === String(fromId))
  const ti = next.findIndex((x) => String(x.id) === String(toId))
  if (fi < 0 || ti < 0 || fi === ti) return list
  const [row] = next.splice(fi, 1)
  next.splice(ti, 0, row)
  return next
}

function HomeLogosPage() {
  const { showToast } = useToast()
  const cached = readAdminSnapshot('home-logos')
  const initial = Array.isArray(cached?.rows)
    ? cached.rows.map(normalizeLogo).filter(Boolean)
    : []
  const [logos, setLogos] = useState(initial)
  const logosRef = useRef(initial)
  logosRef.current = logos
  const loadGenRef = useRef(0)
  const [isLoading, setIsLoading] = useState(initial.length === 0)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [dragId, setDragId] = useState(null)

  const loadLogos = useCallback(async () => {
    const gen = ++loadGenRef.current
    try {
      const raw = await getHomeLogosManage()
      if (gen !== loadGenRef.current) return
      const list = Array.isArray(raw) ? raw : []
      const next = list.map(normalizeLogo).filter(Boolean)
      if (shouldReplaceRows(logosRef.current, next)) setLogos(next)
      writeAdminSnapshot('home-logos', { rows: next })
    } catch (e) {
      if (gen !== loadGenRef.current) return
      showToast('error', e?.message || 'Could not load home logos')
    } finally {
      if (gen === loadGenRef.current) setIsLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (!cancelled) void loadLogos()
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [loadLogos])

  useEffect(() => {
    const url = syncStreamUrl()
    if (!url) return undefined
    let es
    try {
      es = new EventSource(url)
    } catch {
      return undefined
    }
    const onMsg = (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}')
        const t = String(data?.type || data?.event || '')
        if (t.includes('home_logo') || t.includes('home-logos') || t === 'config.home_logos_changed') {
          void loadLogos()
        }
      } catch {
        /* ignore */
      }
    }
    es.addEventListener('message', onMsg)
    es.onmessage = onMsg
    return () => es.close()
  }, [loadLogos])

  const sorted = useMemo(
    () => [...logos].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [logos],
  )

  const persistSortOrder = useCallback(
    async (nextList) => {
      const orders = nextList.map((row, i) => ({ id: row.id, sortOrder: i }))
      setLogos(nextList.map((row, i) => ({ ...row, sortOrder: i })))
      try {
        await postHomeLogosReorder(orders)
        await loadLogos()
        showToast('success', 'Order saved.')
      } catch (e) {
        showToast('error', e?.message || 'Could not reorder')
        await loadLogos()
      }
    },
    [loadLogos, showToast],
  )

  const handleDropOnLogo = useCallback(
    async (e, targetId) => {
      e.preventDefault()
      const fromId = e.dataTransfer.getData('text/plain') || dragId
      if (!fromId) return
      const next = reorderById(sorted, fromId, targetId)
      if (next === sorted) return
      setDragId(null)
      await persistSortOrder(next)
    },
    [dragId, persistSortOrder, sorted],
  )

  async function handleAddSubmit(payload) {
    try {
      const rest = { ...payload }
      delete rest.id
      await postHomeLogo(rest)
      await loadLogos()
      setAddOpen(false)
      showToast('success', 'Logo created.')
    } catch (e) {
      showToast('error', e?.message || 'Could not create logo')
    }
  }

  async function handleEditSubmit(payload) {
    try {
      const { id, ...rest } = payload
      if (!id) return
      await putHomeLogo(id, { ...editing, ...rest })
      await loadLogos()
      setEditing(null)
      showToast('success', 'Logo updated.')
    } catch (e) {
      showToast('error', e?.message || 'Could not update logo')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this home logo? This cannot be undone.')) return
    try {
      await deleteHomeLogo(id)
      await loadLogos()
      showToast('success', 'Logo deleted.')
    } catch (e) {
      showToast('error', e?.message || 'Could not delete logo')
    }
  }

  async function handleToggleActive(logo) {
    try {
      await putHomeLogo(logo.id, {
        ...logo,
        title: logo.title,
        subtitle: logo.subtitle ?? '',
        image: logo.image,
        isActive: !logo.isActive,
        active: !logo.isActive,
        sortOrder: logo.sortOrder,
        redirectChannelId: logo.redirectChannelId ?? logo.redirect_channel_id ?? null,
        linkUrl: logo.linkUrl ?? logo.link_url ?? '',
      })
      await loadLogos()
    } catch (e) {
      showToast('error', e?.message || 'Could not update status')
    }
  }

  return (
    <>
      <Topbar />

      <main className="mt-6 flex min-h-0 flex-1 flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
              Home Screen
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Home Circular Logos
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Circular logo tiles for the App Home screen. Upload any image — it is automatically
              fit into a circle. Drag to reorder. Toggle Active to show or hide in the App.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-950 shadow-[0_8px_32px_rgba(251,191,36,0.35)] transition-all duration-300 hover:scale-[1.02] hover:brightness-105 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Add Logo
          </button>
        </header>

        <HomeLogoFormModal
          variant="add"
          isOpen={addOpen}
          logo={null}
          onClose={() => setAddOpen(false)}
          onSubmit={handleAddSubmit}
        />

        <HomeLogoFormModal
          variant="edit"
          isOpen={Boolean(editing)}
          logo={editing}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
        />

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 p-4"
              >
                <div className="mx-auto h-24 w-24 rounded-full bg-slate-800/80" />
                <div className="mt-4 h-4 w-3/4 rounded bg-slate-700/80" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-600/60 bg-slate-900/30 px-6 py-16 text-center text-sm text-slate-400">
            No logos yet. Click &quot;Add Logo&quot; to create one.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sorted.map((logo, index) => {
              const activeBorder = logo.isActive
                ? 'border-emerald-500/40 shadow-[0_0_28px_rgba(16,185,129,0.18)] ring-2 ring-emerald-400/25'
                : 'border-slate-600/50 grayscale-[0.3] ring-1 ring-slate-700/60'

              return (
                <motion.article
                  key={logo.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: index * 0.04 }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => handleDropOnLogo(e, logo.id)}
                  className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-slate-950/50 p-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 ${activeBorder} ${
                    dragId === logo.id ? 'ring-2 ring-amber-400/50' : ''
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(logo.id))
                      e.dataTransfer.effectAllowed = 'move'
                      setDragId(logo.id)
                    }}
                    onDragEnd={() => setDragId(null)}
                    className="absolute left-2 top-2 z-20 flex cursor-grab items-center justify-center rounded-lg bg-black/50 p-1.5 text-slate-300 ring-1 ring-white/15 hover:text-amber-200 active:cursor-grabbing"
                    aria-label={`Drag to reorder ${logo.title}`}
                  >
                    <GripVertical className="h-4 w-4" strokeWidth={2} />
                  </div>

                  <div className="mx-auto mt-2 h-28 w-28 overflow-hidden rounded-full border-2 border-slate-600/50 bg-slate-800 shadow-inner">
                    {logo.image ? (
                      <img src={logo.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-500">
                        —
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-1 flex-col">
                    <h2 className="line-clamp-2 text-center text-sm font-bold text-white">
                      {logo.title || 'Untitled'}
                    </h2>
                    {logo.subtitle ? (
                      <p className="mt-1 line-clamp-2 text-center text-xs text-slate-400">
                        {logo.subtitle}
                      </p>
                    ) : null}
                    <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-slate-500">
                      Order {logo.sortOrder}
                      {logo.isActive ? '' : ' · Hidden'}
                    </p>

                    <div className="mt-auto flex flex-wrap items-center justify-center gap-2 pt-4">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(logo)}
                        className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                          logo.isActive
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-700/60 text-slate-400'
                        }`}
                      >
                        {logo.isActive ? 'Active' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(logo)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-200 hover:bg-slate-700"
                        aria-label={`Edit ${logo.title}`}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(logo.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-300 hover:bg-red-500/25"
                        aria-label={`Delete ${logo.title}`}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </motion.article>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}

export default HomeLogosPage
