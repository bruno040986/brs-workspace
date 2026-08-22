import FinanceiroSidebar from './_components/FinanceiroSidebar'

export default function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <FinanceiroSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
