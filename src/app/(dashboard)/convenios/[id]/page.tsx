'use client'

import { useParams } from 'next/navigation'
import ConvenioEditor from '../_components/ConvenioEditor'

export default function ConvenioDetalhePage() {
  const params = useParams<{ id: string }>()
  return <ConvenioEditor convenioId={params?.id} />
}
