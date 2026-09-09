'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { SolicitacaoDetalhe } from '../actions'
import { aprovarSolicitacao, reprovarSolicitacao } from '../actions'

const CAMPO_LABEL: Record<string, string> = {
  bank_code: 'Código do banco',
  bank_name: 'Banco',
  bank_agency: 'Agência',
  bank_account: 'Conta',
  bank_account_type: 'Tipo de conta',
  pix_type: 'Tipo de chave Pix',
  pix_key: 'Chave Pix',
  commission_receive_type: 'Tipo de recebimento',
  payment_period: 'Período de pagamento',
  name: 'Razão social / Nome',
  fantasy_name: 'Nome fantasia',
  cep: 'CEP',
  address_street: 'Logradouro',
  address_number: 'Número',
  address_complement: 'Complemento',
  address_neighborhood: 'Bairro',
  address_city: 'Cidade',
  address_state: 'UF',
  phone_whatsapp: 'WhatsApp principal',
  phone_whatsapp_financeiro: 'WhatsApp financeiro',
  phone_commercial: 'Telefone comercial',
  phone_support: 'Telefone suporte',
  email_comissao: 'E-mail (comissão)',
  email_financeiro: 'E-mail financeiro',
  email_informe: 'E-mail de informes',
  email_juridico: 'E-mail jurídico',
  email_mesa_liberacao: 'E-mail mesa de liberação',
}

const TIPO_LABEL: Record<string, string> = {
  bancario: 'Dados Bancários',
  contato: 'Dados de Contato',
  cadastral: 'Dados Cadastrais',
}

function formatarValor(v: unknown): string {
  if (v == null || v === '') return '—'
  if (Array.isArray(v)) return JSON.stringify(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function SolicitacaoDetalheClient({
  item,
  documentoSignedUrl,
  podeEditar,
}: {
  item: SolicitacaoDetalhe
  documentoSignedUrl: string | null
  podeEditar: boolean
}) {
  const router = useRouter()
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')

  const camposAlterados = Object.keys(item.dadosSolicitados)

  async function handleAprovar() {
    setProcessando(true)
    setErro(null)
    const result = await aprovarSolicitacao(item.id)
    setProcessando(false)
    if (!result.success) return setErro(result.error || 'Falha ao aprovar.')
    router.refresh()
  }

  async function handleReprovar() {
    setProcessando(true)
    setErro(null)
    const result = await reprovarSolicitacao(item.id, motivo)
    setProcessando(false)
    if (!result.success) return setErro(result.error || 'Falha ao reprovar.')
    router.refresh()
  }

  return (
    <div className="page-shell">
      <Link href="/agente-corban/solicitacoes" style={{ fontSize: '0.85rem' }}>
        ← Voltar
      </Link>
      <h1>Solicitação — {item.agenteParceiroNome}</h1>
      <p>
        Tipo: <strong>{TIPO_LABEL[item.tipo] ?? item.tipo}</strong> · Status:{' '}
        <strong>{item.status}</strong>
      </p>

      {item.justificativa && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-body">
            <strong>Justificativa do parceiro:</strong>
            <p style={{ margin: '0.4rem 0 0' }}>{item.justificativa}</p>
          </div>
        </div>
      )}

      {documentoSignedUrl && (
        <p>
          <a href={documentoSignedUrl} target="_blank" rel="noreferrer">
            Ver comprovante/extrato enviado
          </a>
        </p>
      )}

      <table className="data-table" style={{ marginTop: '1rem' }}>
        <thead>
          <tr>
            <th>Campo</th>
            <th>Valor atual</th>
            <th>Valor solicitado</th>
          </tr>
        </thead>
        <tbody>
          {camposAlterados.map((campo) => (
            <tr key={campo}>
              <td>{CAMPO_LABEL[campo] ?? campo}</td>
              <td>{formatarValor(item.dadosAtuais[campo])}</td>
              <td style={{ fontWeight: 600 }}>{formatarValor(item.dadosSolicitados[campo])}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {item.status === 'reprovada' && item.motivoReprovacao && (
        <p style={{ color: 'var(--brs-danger)', marginTop: '1rem' }}>Motivo da reprovação: {item.motivoReprovacao}</p>
      )}

      {erro && (
        <p role="alert" style={{ color: 'var(--brs-danger)' }}>
          {erro}
        </p>
      )}

      {podeEditar && item.status === 'pendente' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1.2rem', maxWidth: 480 }}>
          <button type="button" className="btn btn-success" onClick={handleAprovar} disabled={processando}>
            {processando ? 'Processando…' : 'Aprovar e aplicar no cadastro'}
          </button>
          <textarea
            className="form-control"
            placeholder="Motivo da reprovação (obrigatório pra reprovar)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
          />
          <button type="button" className="btn btn-danger" onClick={handleReprovar} disabled={processando}>
            {processando ? 'Processando…' : 'Reprovar'}
          </button>
        </div>
      )}
    </div>
  )
}
