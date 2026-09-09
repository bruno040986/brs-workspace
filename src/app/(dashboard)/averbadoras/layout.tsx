/**
 * O menu contextual deste subsistema vive na sidebar global por divisões
 * (src/lib/nav/divisoes.ts) — este layout só preserva o padding de
 * conteúdo (.rh-content), mesmo padrão de `convenios/layout.tsx`.
 */
export default function AverbadorasLayout({ children }: { children: React.ReactNode }) {
  return <div className="rh-content">{children}</div>
}
