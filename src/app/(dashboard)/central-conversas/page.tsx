import { getCentralConversasView } from '@/lib/central-conversas/actions'
import InstanciasClient from './_components/InstanciasClient'

export const dynamic = 'force-dynamic'

export default async function CentralConversasPage() {
  const view = await getCentralConversasView()
  return <InstanciasClient view={view} />
}
