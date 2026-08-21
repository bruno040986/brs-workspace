import CentralSidebar from './_components/CentralSidebar'

export default function CentralIntegracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <CentralSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
