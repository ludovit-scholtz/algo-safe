export const Icon = ({ name, className = '' }: { name: string; className?: string }) =>
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
