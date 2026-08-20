import NvtiSidebar from './_components/NvtiSidebar'

export default function HigienizacaoNvtiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <NvtiSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
