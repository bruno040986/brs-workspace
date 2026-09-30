/**
 * Cadastros › Status e Situações de Proposta — o menu vive na sidebar global
 * (src/lib/nav/divisoes.ts); este layout só preserva o padding de conteúdo.
 */
export default function PropostasCatalogosLayout({ children }: { children: React.ReactNode }) {
  return <div className="rh-content">{children}</div>
}
