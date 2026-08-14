'use client'

import { useParams, useSearchParams } from 'next/navigation'
import InstituicaoEditor from '../_components/InstituicaoEditor'

export default function InstituicaoFinanceiraDetalhePage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const mode = searchParams.get('mode')

  return <InstituicaoEditor instituicaoId={params?.id} readOnly={mode === 'view'} />
}
