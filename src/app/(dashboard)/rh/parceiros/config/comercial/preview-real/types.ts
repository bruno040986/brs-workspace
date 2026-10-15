import type { ComercialRole } from '@/lib/comerciais-hierarquia'

export type PreviewRealEntity = {
  id: string
  name: string
  role: ComercialRole
  status?: 'ativo' | 'inativo'
  commercial_slug?: string | null
  card_enabled?: boolean | null
  user_id?: string | null
  parent?: { id: string; name: string; role: string } | null
}
