import { notFound } from 'next/navigation'
import ArteEditor from '../_components/ArteEditor'
import { getArte } from '@/lib/marketing/artes-actions'

export default async function EditarArtePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await getArte(id)
  if (!res.success || !res.data) notFound()
  return <ArteEditor arte={res.data} />
}
