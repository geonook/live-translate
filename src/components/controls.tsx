import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Icon } from './Icon'

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0d]'

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-left ${className ?? ''}`}>
      <span className="text-xs font-medium text-gray-400 tabular-nums">{label}</span>
      {children}
    </label>
  )
}

export const selectClass = `min-h-[44px] w-full cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 pr-9 text-base text-gray-100 outline-none transition hover:bg-white/[0.07] focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`

type SelectOption = { value: string; label: ReactNode }

/* Fully custom accessible listbox — replaces the native <select> so the dropdown
 * renders identically on every OS/browser (Windows Chrome can't style native
 * <option>s). Drop-in: keeps the <Select><option/></Select> API by parsing the
 * <option> children. Implements the WAI-ARIA listbox keyboard pattern
 * (arrows / Home / End / Enter / Esc / typeahead, active via aria-activedescendant). */
export function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string | number
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  const options: SelectOption[] = Children.toArray(children)
    .filter((c): c is ReactElement<{ value: string | number; children: ReactNode }> =>
      isValidElement(c),
    )
    .map((c) => ({ value: String(c.props.value), label: c.props.children }))

  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()

  const selectedIdx = options.findIndex((o) => o.value === String(value))
  const selected = selectedIdx >= 0 ? options[selectedIdx] : undefined

  function openList() {
    if (disabled) return
    setActiveIdx(selectedIdx >= 0 ? selectedIdx : 0)
    setOpen(true)
  }
  function closeList(focusButton = true) {
    setOpen(false)
    if (focusButton) btnRef.current?.focus()
  }
  function commit(idx: number) {
    const opt = options[idx]
    if (opt) onChange(opt.value)
    closeList()
  }

  // Move keyboard focus into the list when it opens.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIdx])

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIdx(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIdx(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIdx)
        break
      case 'Escape':
        e.preventDefault()
        closeList()
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        // Typeahead: jump to the next option whose label starts with the key.
        if (e.key.length === 1) {
          const ch = e.key.toLowerCase()
          for (let n = 1; n <= options.length; n++) {
            const i = (activeIdx + n) % options.length
            const lbl = options[i].label
            if (typeof lbl === 'string' && lbl.toLowerCase().startsWith(ch)) {
              setActiveIdx(i)
              break
            }
          }
        }
    }
  }

  function onButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={`${selectClass} flex items-center text-left`}
      >
        <span className="truncate">{selected?.label}</span>
      </button>
      <Icon
        name="chevron"
        size={16}
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-transform motion-reduce:transition-none ${
          open ? 'rotate-180' : ''
        }`}
      />
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${baseId}-opt-${activeIdx}`}
          onKeyDown={onListKeyDown}
          className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#15151a] py-1 shadow-xl shadow-black/50 outline-none"
        >
          {options.map((opt, idx) => {
            const isSelected = idx === selectedIdx
            const isActive = idx === activeIdx
            return (
              <li
                key={opt.value}
                id={`${baseId}-opt-${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={(e) => {
                  // The whole Select sits inside a <label> (Field); without this
                  // the label forwards the click to the trigger button and
                  // immediately reopens the popup. Stop that default activation.
                  e.preventDefault()
                  commit(idx)
                }}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-base ${
                  isActive ? 'bg-white/10' : ''
                } ${isSelected ? 'text-sky-200' : 'text-gray-100'}`}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isSelected && <Icon name="check" size={16} />}
                </span>
                <span className="truncate">{opt.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${FOCUS_RING} ${
            value === opt.value
              ? 'border-sky-400 bg-sky-500/15 text-sky-200'
              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
          }`}
        >
          {value === opt.value && <Icon name="check" size={16} />}
          {opt.label}
        </button>
      ))}
    </div>
  )
}
