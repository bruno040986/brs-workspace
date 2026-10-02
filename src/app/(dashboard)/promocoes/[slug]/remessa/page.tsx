import { requirePermission } from '@/lib/auth/server'
import RemessaClient from './RemessaClient'

export default async function RemessaPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission('comercial-promocoes-remessa', 'can_view')
  const { slug } = await params
  return <RemessaClient slug={slug} />
}
