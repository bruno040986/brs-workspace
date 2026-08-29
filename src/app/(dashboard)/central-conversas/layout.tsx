import CentralConversasSidebar from './_components/CentralConversasSidebar'

export default function CentralConversasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <CentralConversasSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
