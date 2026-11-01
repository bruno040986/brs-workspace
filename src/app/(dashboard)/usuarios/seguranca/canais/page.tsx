import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { salvarCanal } from './actions'

export const dynamic = 'force-dynamic'

// Mostra apenas ESTADO (configurado sim/não). Nenhum segredo, chat_id ou telefone é lido de volta para a tela.
export default async function CanaisPage() {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'sistema-usuarios-root', 'can_edit')) redirect('/acesso-negado')
  const admin = await createAdminClient()
  const [{ data: canais }, { data: segs }] = await Promise.all([
    admin.from('seg_canais_config').select('canal, habilitado, config, atualizado_em'),
    admin.from('seg_destinos_protegidos').select('canal, chave'),
  ])
  const tem = (c: string, k: string) => (segs || []).some((s: { canal: string; chave: string }) => s.canal === c && s.chave === k)
  const por = Object.fromEntries((canais || []).map((c: { canal: string; habilitado: boolean; config: Record<string, unknown> }) => [c.canal, c]))
  const inst = ((por.whatsapp?.config?.instancias ?? []) as { ordem: number; instancia_id: string | null; numero_esperado: string }[])
  return (
    <div style={{ padding: '1.5rem', maxWidth: 720 }}>
      <h1>Segurança › Canais de notificação</h1>
      <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>Todos nascem desligados. Segredos ficam cifrados e não são exibidos. Nenhuma mensagem de teste é enviada por esta tela.</p>
      {(['telegram', 'whatsapp', 'email'] as const).map((canal) => (
        <form key={canal} action={salvarCanal} style={{ border: '1px solid #8884', borderRadius: 8, padding: '1rem', margin: '1rem 0', display: 'grid', gap: '0.5rem' }}>
          <input type="hidden" name="canal" value={canal} />
          <strong>{canal} — {por[canal]?.habilitado ? 'LIGADO' : 'desligado'}</strong>
          {canal === 'telegram' && (<>
            <label>Token do bot ({tem('telegram', 'bot_token') ? 'já configurado' : 'falta'})<input className="form-control" type="password" name="bot_token" autoComplete="off" /></label>
            <label>Chat ID ({tem('telegram', 'chat_id') ? 'já configurado' : 'falta'})<input className="form-control" name="chat_id" autoComplete="off" /></label>
          </>)}
          {canal === 'whatsapp' && (<>
            <label>Telefone de destino do alerta, com DDI ({tem('whatsapp', 'destino') ? 'já configurado' : 'falta'})<input className="form-control" name="destino" autoComplete="off" /></label>
            <ol style={{ fontSize: '0.85rem' }}>{inst.map((i) => <li key={i.ordem}>Instância {i.ordem}: {i.instancia_id ? 'id configurado' : 'SEM ID (confirmar com o Bruno)'} — número esperado final {String(i.numero_esperado).slice(-4)}</li>)}</ol>
          </>)}
          {canal === 'email' && <span style={{ fontSize: '0.85rem' }}>Destino: {String(por.email?.config?.destino ?? 'não definido')}. Remetente e chave: configuração Resend existente.</span>}
          <label><input type="checkbox" name="habilitado" defaultChecked={Boolean(por[canal]?.habilitado)} /> Habilitado</label>
          <button type="submit" className="btn btn-primary" style={{ width: 'fit-content' }}>Salvar</button>
        </form>
      ))}
    </div>
  )
}
