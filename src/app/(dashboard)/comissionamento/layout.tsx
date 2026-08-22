import ComissionamentoSidebar from './_components/ComissionamentoSidebar'

export default function ComissionamentoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <ComissionamentoSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
