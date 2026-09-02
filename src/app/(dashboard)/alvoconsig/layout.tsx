/**
 * O menu contextual deste subsistema agora vive na sidebar global por
 * divisões (src/lib/nav/divisoes.ts) — este layout só preserva o padding
 * de conteúdo (.rh-content).
 */
export default function AlvoconsigLayout({ children }: { children: React.ReactNode }) {
  return <div className="rh-content">{children}</div>
}
