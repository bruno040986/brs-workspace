import PrazoComissaoEditor from '../_components/PrazoComissaoEditor'

export default async function EditarPrazoComissaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PrazoComissaoEditor prazoId={id} />
}
