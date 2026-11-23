import { Icon } from './Icon'

export function StatusPill({
  connected,
  connecting,
  running,
  status,
}: {
  connected: boolean
  connecting: boolean
  running: boolean
  status: string
}) {
  return (
    <span
      className={`inline-flex max-w-[12rem] items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
        connected
          ? 'bg-emerald-500/15 text-emerald-300'
          : running
            ? 'bg-amber-500/15 text-amber-300'
            : 'bg-white/5 text-gray-300'
      }`}
    >
      {connecting ? (
        <Icon name="loader" size={12} className="animate-spin" />
      ) : (
        <span
          className={`h-2 w-2 rounded-full ${
            connected
              ? 'bg-emerald-400'
              : running
                ? 'bg-amber-400 catchup'
                : 'bg-gray-500'
          }`}
        />
      )}
      <span className="min-w-0 truncate tabular-nums" title={status}>
        {status}
      </span>
    </span>
  )
}

export function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-gray-300'
      }`}
    >
      {done ? <Icon name="check" size={12} /> : n}
    </span>
  )
}
