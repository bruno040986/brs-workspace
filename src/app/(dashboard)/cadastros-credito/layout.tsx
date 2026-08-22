import CadastrosCreditoSidebar from './_components/CadastrosCreditoSidebar'

export default function CadastrosCreditoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <CadastrosCreditoSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
