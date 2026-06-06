export const Stepper = ({ steps, current }: { steps: string[]; current: number }) => (
  <div className="flex items-center">{steps.map((s, i) => (<div key={s} className="flex flex-1 items-center last:flex-none">
    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${i <= current ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>{i + 1}</div>
    <span className="ml-2 text-sm text-on-surface-variant">{s}</span>{i < steps.length - 1 && <div className="mx-3 h-px flex-1 bg-outline-variant" />}</div>))}</div>
)
