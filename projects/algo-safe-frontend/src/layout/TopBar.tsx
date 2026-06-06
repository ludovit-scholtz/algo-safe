import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { Button } from '../components/ui/Button'
import { AuthStatus } from '../components/AuthStatus'
import { useSafe } from '../hooks'

export function TopBar() {
  const { safeId } = useParams<{ safeId: string }>()
  const nav = useNavigate()
  const { data: safe } = useSafe(safeId)
  return (
    <header className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-3">
      <button className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface" onClick={() => nav('/')}>
        <Icon name="unfold_more" className="text-lg" /><span className="font-medium text-on-surface">{safe?.name ?? 'Select safe'}</span>
      </button>
      <div className="flex items-center gap-3">
        <AuthStatus />
        <Link to={`/safe/${safeId}/agents/register`}><Button><Icon name="add" className="text-lg" />Register Agent</Button></Link>
      </div>
    </header>
  )
}
