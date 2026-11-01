'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  confirmarAtivacaoTotp, iniciarAtivacaoEmail, iniciarAtivacaoTotp, iniciarDesafioEmail, sair,
  verificarCodigoAtivacao, verificarCodigoEmail, verificarTotp, type ResultadoAcesso,
} from './actions'

type Passo = 'ativar_email' | 'ativar_totp' | 'totp' | 'email'

// UI minima. O contador e so exibicao: a pausa e imposta no banco.
function useContagem(inicial: number) {
  const [seg, setSeg] = useState(inicial)
  useEffect(() => {
    if (seg <= 0) return
    const t = setTimeout(() => setSeg((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seg])
  return [seg, setSeg] as const
}

export default function AcessoEtapas({ proximo, pausaInicialSeg, instabilidade }: { proximo: Passo; pausaInicialSeg: number; instabilidade: boolean }) {
  const router = useRouter()
  const [passo, setPasso] = useState<Passo>(proximo)
  const [codigo, setCodigo] = useState('')
  const [msg, setMsg] = useState(instabilidade ? 'Serviço de autenticação instável. Tente novamente.' : '')
  const [pausa, setPausa] = useContagem(pausaInicialSeg)
  const [espera, setEspera] = useContagem(0)
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; segredo: string } | null>(null)
  const [pending, start] = useTransition()

  function aplicar(r: ResultadoAcesso, aoOk?: () => void) {
    setMsg(r.ok ? '' : r.mensagem || 'Não foi possível concluir o acesso.')
    if (r.pausaSeg) setPausa(r.pausaSeg)
    if (r.esperaSeg) setEspera(r.esperaSeg)
    if (r.ok) { setCodigo(''); aoOk?.() }
  }
  const concluir = () => { router.push('/'); router.refresh() }

  function enviarCodigo(ativacao: boolean) {
    start(async () => aplicar(await (ativacao ? iniciarAtivacaoEmail() : iniciarDesafioEmail())))
  }

  function confirmar() {
    start(async () => {
      if (passo === 'ativar_email') return aplicar(await verificarCodigoAtivacao(codigo), async () => {
        const r = await iniciarAtivacaoTotp()
        if (r.ok && r.factorId && r.qrCode) { setEnroll({ factorId: r.factorId, qrCode: r.qrCode, segredo: r.segredoManual || '' }); setPasso('ativar_totp') }
        else setMsg(r.mensagem || 'Não foi possível iniciar a ativação.')
      })
      if (passo === 'ativar_totp' && enroll) return aplicar(await confirmarAtivacaoTotp(enroll.factorId, codigo), () => { setEnroll(null); setPasso('email') })
      if (passo === 'totp') return aplicar(await verificarTotp(codigo), () => setPasso('email'))
      return aplicar(await verificarCodigoEmail(codigo), concluir)
    })
  }

  const titulo = { ativar_email: 'Ativar autenticador: confirme seu e-mail', ativar_totp: 'Ative o Google Authenticator', totp: 'Código do Google Authenticator', email: 'Código enviado ao seu e-mail' }[passo]
  const precisaEnviar = passo === 'ativar_email' || passo === 'email'

  return (
    <div className="login-page">
      <div className="login-card">
        <h2 style={{ marginBottom: '1rem' }}>{titulo}</h2>
        {msg && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{msg}</div>}
        {pausa > 0 && <div className="alert" style={{ marginBottom: '1rem' }}>Aguarde {Math.floor(pausa / 60)}:{String(pausa % 60).padStart(2, '0')} para tentar de novo.</div>}
        {passo === 'ativar_totp' && enroll && (
          <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
            {/* QR do Supabase MFA (data URI SVG). Segredo manual so em tela; nunca logado. */}
            <img src={enroll.qrCode} alt="QR code do autenticador" width={180} height={180} />
            <p style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>Ou digite a chave: {enroll.segredo}</p>
          </div>
        )}
        {precisaEnviar && (
          <button type="button" className="btn btn-secondary" style={{ width: '100%', marginBottom: '0.75rem' }} disabled={pending || espera > 0} onClick={() => enviarCodigo(passo === 'ativar_email')}>
            {espera > 0 ? `Reenviar em ${espera}s` : 'Enviar código por e-mail'}
          </button>
        )}
        <form onSubmit={(e) => { e.preventDefault(); confirmar() }}>
          <input className="form-control" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '0.75rem' }} disabled={pending || pausa > 0 || codigo.length !== 6}>Confirmar</button>
        </form>
        <button type="button" className="btn" style={{ width: '100%', marginTop: '0.75rem' }} onClick={() => start(async () => { await sair('esta'); router.push('/login') })}>Cancelar e sair</button>
      </div>
    </div>
  )
}
