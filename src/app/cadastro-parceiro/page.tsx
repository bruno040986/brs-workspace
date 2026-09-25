import { permanentRedirect } from 'next/navigation'

const PORTAL_CADASTRO = `${process.env.NEXT_PUBLIC_PORTAL_URL || 'https://parceiro.brspromotora.com.br'}/cadastro`

/**
 * Formulário público do SCP (legado, removido em 25/09/2026). Links antigos
 * impressos em cartões/QR continuam funcionando: caem no cadastro do Portal.
 */
export default function CadastroParceiroLegadoPage() {
  permanentRedirect(PORTAL_CADASTRO)
}
