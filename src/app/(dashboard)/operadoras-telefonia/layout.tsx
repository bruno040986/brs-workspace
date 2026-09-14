/**
 * O menu contextual deste subsistema vive na sidebar global por divisões
 * (src/lib/nav/divisoes.ts) — este layout só preserva o padding de
 * conteúdo (.rh-content), mesmo padrão de `averbadoras/layout.tsx`.
 */
export default function OperadorasTelefoniaLayout({ children }: { children: React.ReactNode }) {
  return <div className="rh-content">{children}</div>
}
