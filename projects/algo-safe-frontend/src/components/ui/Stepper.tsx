export const Stepper = ({ steps, current }: { steps: string[]; current: number }) => (
  <div className="flex items-center">{steps.map((s, i) => (<div key={s} className="flex flex-1 items-center last:flex-none">
    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${i <= current ? 'bg-ink-900 text-white' : 'bg-brand-50 text-ink-500'}`}>{i + 1}</div>
    <span className="ml-2 text-sm text-ink-700">{s}</span>{i < steps.length - 1 && <div className="mx-3 h-px flex-1 bg-surface-border" />}</div>))}</div>
)
