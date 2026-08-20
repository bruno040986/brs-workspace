import AgendaSidebar from './_components/AgendaSidebar'

export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <AgendaSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
