import { useCallback, useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import ToggleSwitch from './ToggleSwitch'

function emptyForm() {
  return {
    title: '',
    subtitle: '',
    isActive: true,
    sortOrder: 0,
    redirectChannelId: '',
    linkUrl: '',
  }
}

function logoToForm(logo) {
  if (!logo) return emptyForm()
  return {
    title: logo.title ?? '',
    subtitle: logo.subtitle ?? '',
    isActive: logo.isActive !== false && logo.active !== false,
    sortOrder: Number(logo.sortOrder ?? logo.sort_order ?? 0) || 0,
    redirectChannelId:
      logo.redirectChannelId != null || logo.redirect_channel_id != null
        ? String(logo.redirectChannelId ?? logo.redirect_channel_id)
        : '',
    linkUrl: logo.linkUrl ?? logo.link_url ?? '',
  }
}

function labelClassName() {
  return 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400'
}

function inputClassName() {
  return 'w-full rounded-xl border border-slate-600/60 bg-slate-900/80 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none focus:ring-1 focus:ring-amber-400/40'
}

/**
 * Add / Edit Home Circular Logo modal.
 * Accepts any image aspect ratio — server crops/fits into a circle.
 */
function HomeLogoFormModal({ variant, isOpen, logo, onClose, onSubmit }) {
  const formId = useId()
  const [form, setForm] = useState(() => logoToForm(logo))
  const [imagePreview, setImagePreview] = useState(null)
  const [imageDataUrl, setImageDataUrl] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    setSubmitError(null)
    if (variant === 'edit' && logo) {
      setForm(logoToForm(logo))
      setImagePreview(logo.image ?? logo.imageUrl ?? null)
      setImageDataUrl(null)
    }
    if (variant === 'add') {
      setForm(emptyForm())
      setImagePreview(null)
      setImageDataUrl(null)
    }
  }, [isOpen, variant, logo])

  useEffect(() => {
    return () => {
      if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  const handleBackdropMouseDown = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!isOpen) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setImagePreview(URL.createObjectURL(file))
    const reader = new FileReader()
    reader.onload = () => {
      setImageDataUrl(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsDataURL(file)
  }

  function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    const title = form.title.trim()
    if (!title) {
      setSubmitError('Title is required.')
      return
    }
    const isEdit = variant === 'edit'
    const imageUrl =
      imageDataUrl ||
      (typeof imagePreview === 'string' && !imagePreview.startsWith('blob:') ? imagePreview : '') ||
      (isEdit && (logo?.image || logo?.imageUrl) ? logo.image || logo.imageUrl : '') ||
      ''
    if (!imageUrl) {
      setSubmitError('Please upload a logo image (any size — it will be fit into a circle).')
      return
    }

    const redirectRaw = String(form.redirectChannelId || '').trim()
    const redirectChannelId = redirectRaw === '' ? null : Number(redirectRaw)

    onSubmit({
      ...(isEdit && logo?.id != null ? { id: logo.id } : {}),
      title,
      subtitle: form.subtitle.trim(),
      image: imageUrl,
      isActive: form.isActive,
      active: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
      redirectChannelId: Number.isFinite(redirectChannelId) ? redirectChannelId : null,
      linkUrl: form.linkUrl.trim(),
    })
  }

  if (!isOpen) return null

  const titleHeading = variant === 'edit' ? form.title || 'Logo' : 'Add Logo'
  const submitLabel = variant === 'edit' ? 'Update Logo' : 'Add Logo'
  const previewSrc =
    imageDataUrl ||
    (typeof imagePreview === 'string' ? imagePreview : null) ||
    (variant === 'edit' && logo?.image ? logo.image : null)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-heading`}
    >
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        aria-hidden
        onMouseDown={handleBackdropMouseDown}
      />

      <div className="relative flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-600/50 bg-[#0f172a] shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-amber-500/15">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-700/70 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
              {variant === 'edit' ? 'Edit logo' : 'New logo'}
            </p>
            <h2 id={`${formId}-heading`} className="mt-1 text-xl font-bold text-white">
              {titleHeading}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-amber-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="custom-scrollbar flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            <div className="space-y-5">
              <div>
                <label htmlFor={`${formId}-title`} className={labelClassName()}>
                  Title
                </label>
                <input
                  id={`${formId}-title`}
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputClassName()}
                  placeholder="Logo title"
                  required
                />
              </div>

              <div>
                <label htmlFor={`${formId}-subtitle`} className={labelClassName()}>
                  Subtitle{' '}
                  <span className="font-normal normal-case text-slate-500">(optional)</span>
                </label>
                <input
                  id={`${formId}-subtitle`}
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                  className={inputClassName()}
                  placeholder="Short subtitle"
                />
              </div>

              <div>
                <span className={labelClassName()}>Image</span>
                <p className="mb-2 text-xs text-slate-500">
                  PNG, JPG, JPEG or WEBP — any dimensions. Server fits it into a circular frame.
                </p>
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/*"
                    onChange={handleImageChange}
                    className="block w-full text-sm text-slate-400 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-500/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-amber-200 hover:file:bg-amber-500/30"
                  />
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-600/70 bg-slate-900/50">
                    {previewSrc ? (
                      <img src={previewSrc} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="px-2 text-center text-[10px] text-slate-500">No image</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-600/50 bg-slate-900/40 px-3 py-3">
                <span className="text-sm font-medium text-slate-300">Active</span>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-bold uppercase tracking-wide ${form.isActive ? 'text-slate-500' : 'text-slate-300'}`}
                  >
                    Off
                  </span>
                  <ToggleSwitch
                    checked={form.isActive}
                    onChange={(next) => setForm((f) => ({ ...f, isActive: next }))}
                    aria-label="Toggle active"
                  />
                  <span
                    className={`text-xs font-bold uppercase tracking-wide ${form.isActive ? 'text-amber-200' : 'text-slate-500'}`}
                  >
                    On
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor={`${formId}-sort`} className={labelClassName()}>
                  Sort Order
                </label>
                <input
                  id={`${formId}-sort`}
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  className={inputClassName()}
                />
              </div>

              <div>
                <label htmlFor={`${formId}-redirect`} className={labelClassName()}>
                  Click target — Channel ID{' '}
                  <span className="font-normal normal-case text-slate-500">(optional)</span>
                </label>
                <input
                  id={`${formId}-redirect`}
                  type="number"
                  value={form.redirectChannelId}
                  onChange={(e) => setForm((f) => ({ ...f, redirectChannelId: e.target.value }))}
                  className={inputClassName()}
                  placeholder="e.g. 2"
                />
              </div>

              <div>
                <label htmlFor={`${formId}-link`} className={labelClassName()}>
                  Click target — Link URL{' '}
                  <span className="font-normal normal-case text-slate-500">(optional)</span>
                </label>
                <input
                  id={`${formId}-link`}
                  type="text"
                  value={form.linkUrl}
                  onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
                  className={inputClassName()}
                  placeholder="https://… or /path"
                />
              </div>

              {submitError ? (
                <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200 ring-1 ring-red-400/30">
                  {submitError}
                </p>
              ) : null}
            </div>
          </div>

          <footer className="shrink-0 border-t border-slate-700/70 bg-[#0f172a]/95 px-5 py-4">
            <button
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 py-3 text-sm font-bold text-slate-950 shadow-[0_8px_28px_rgba(251,191,36,0.35)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
            >
              {submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

export default HomeLogoFormModal
