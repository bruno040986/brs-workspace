import { redirect } from 'next/navigation'

// Campanha única por enquanto; quando houver mais de uma, vira lista de cards.
export default function PromocoesPage() {
  redirect('/promocoes/promocao-servidor-publico')
}
