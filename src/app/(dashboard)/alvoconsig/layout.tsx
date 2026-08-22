import AlvoconsigSidebar from './_components/AlvoconsigSidebar'

export default function AlvoconsigLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <AlvoconsigSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
