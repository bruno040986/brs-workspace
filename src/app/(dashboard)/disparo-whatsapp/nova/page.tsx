import { Suspense } from 'react'
import CampaignWizard from '../_components/wizard/CampaignWizard'

export default function NovaCampanhaPage() {
  return (
    <Suspense fallback={null}>
      <CampaignWizard />
    </Suspense>
  )
}
