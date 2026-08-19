import DisparoWhatsappSidebar from './_components/DisparoWhatsappSidebar'

export default function DisparoWhatsappLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <DisparoWhatsappSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
