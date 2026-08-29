import { getCentralConversasView } from '@/lib/central-conversas/actions'
import CanaisClient from '../_components/CanaisClient'

export const dynamic = 'force-dynamic'

export default async function CentralConversasCanaisPage() {
  const view = await getCentralConversasView()
  return <CanaisClient view={view} />
}
