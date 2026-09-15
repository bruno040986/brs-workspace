/**
 * Ofertas disponíveis (simulação em tempo real) do Amigoz — Fatia 3. SÓ servidor.
 *
 * Fluxo (docs/ROTEIRO-AMIGOZ-FATIA-3-OFERTAS.md, seções 0 e 3):
 *   1. `garantirClienteAmigoz` — cria o cliente no Amigoz (POST /api/cliente,
 *      pré-requisito da simulação; sem ele a simulação volta AOS002) se ainda
 *      não tiver `cliente_externo_id`.
 *   2. `simularOfertasAmigoz` — uma `POST /api/simulacao/cartao` por produto
 *      com margem > 0 (RCC: tipo_produto 7; RMC: tipo_produto 15).
 *
 * ATENÇÃO — MAPEAMENTO PROVISÓRIO de `normalizarOfertaAmigoz` (15/09/2026): a
 * descoberta obrigatória (seção 0 do roteiro) rodou com um CPF real (Piauí,
 * convênio 25) que tem margem de cartão, mas NUNCA teve um cartão ativo em
 * nenhum banco — toda tentativa de `simulacao-cartao` (produto 7 e 15) voltou
 * HTTP 400 "AOS002 - Esse cliente não possui contrato com cartão criado na
 * processadora", inclusive DEPOIS de criar o cliente. Não existe, portanto,
 * nenhuma resposta de SUCESSO real registrada em `if_credito_chamadas` pra
 * fixar o formato de `OfertaNormalizada` — os schemas da doc do Amigoz estão
 * vazios (achado conhecido desde a Fatia 1). `normalizarOfertaAmigoz` tenta
 * várias grafias plausíveis a partir dos RÓTULOS da tela do Amigoz (limite
 * pré-aprovado, saque, parcelas, taxa/CET, 1º vencimento) e devolve `null`
 * quando nada bate — o chamador registra `ofertas_status='erro'` e preserva a
 * resposta crua (ela já fica em `if_credito_chamadas` de qualquer forma) pra
 * recalibrar isto assim que houver uma simulação de SUCESSO real (precisa de
 * um CPF com cartão já ativo, ou da Fase 4 — digitar contrato — pra abrir um).
 * NÃO habilitar `buscar_ofertas` em produção antes de validar isso.
 */
import { getContact, findContactByCpf } from '@/lib/wesales/client'
import { chamarAmigozAutenticado, mensagemErroAmigoz, obterInstituicaoAmigoz, type ConfigAmigoz } from './client'
import { normalizarOfertaAmigoz } from './normalizar-oferta'
import type { OfertaNormalizada, ProdutoOferta } from '../ofertas'

export { normalizarOfertaAmigoz }

/** Aceito na descoberta (criar-cliente, 15/09/2026) — não há como descobrir os demais códigos sem testar ao vivo. */
export const ESCOLARIDADE_PADRAO = 1

type Json = Record<string, unknown>

function ehObjeto(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function digitsOuNull(v: string | null | undefined): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  return d ? d : null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extrairClienteId(corpo: unknown): string | null {
  if (!ehObjeto(corpo)) return null
  const cliente = ehObjeto(corpo.cliente) ? corpo.cliente : corpo
  const id = cliente.id
  return id !== undefined && id !== null && id !== '' ? String(id) : null
}

export type ItemParaOferta = {
  cpf: string
  nome: string | null // nome de entrada (CSV/WeSales) — fallback se nomeIf vazio
  nomeIf: string | null
  nascimentoIf: string | null // dd/mm/aaaa (como a consulta de margem devolveu)
  matriculaIf: string | null
  telefone: string | null // telefone de entrada
  wesalesContactId: string | null
  convenioExternoUsado: string | null
  margemConsignado: number | null
  margemBeneficioCompra: number | null
  margemBeneficioSaque: number | null
  clienteExternoId: string | null
}

export type ResultadoGarantirCliente = { ok: true; clienteExternoId: string } | { ok: false; mensagem: string }

/**
 * Cria o cliente no Amigoz se `item.clienteExternoId` ainda não existir.
 * Escolhe o produto RCC (compra+saque, tipo_produto 7) quando há margem de
 * benefício; senão RMC (tipo_produto 15) — são os dois payloads reais que a
 * descoberta confirmou funcionar. Nunca cria sem telefone (obrigatório na IF).
 */
export async function garantirClienteAmigoz(cfg: ConfigAmigoz, item: ItemParaOferta, criadoPor?: string | null): Promise<ResultadoGarantirCliente> {
  if (item.clienteExternoId) return { ok: true, clienteExternoId: item.clienteExternoId }

  let telefone = digitsOuNull(item.telefone)
  if (!telefone) {
    const contato = item.wesalesContactId ? await getContact(item.wesalesContactId) : await findContactByCpf(item.cpf)
    telefone = digitsOuNull(contato?.phone ?? null)
  }
  if (!telefone) return { ok: false, mensagem: 'Sem telefone (nem na entrada, nem no contato do WeSales) — obrigatório pra criar o cliente no Amigoz.' }
  if (!item.nascimentoIf) return { ok: false, mensagem: 'Sem data de nascimento (a IF não devolveu na consulta de margem).' }
  if (!item.convenioExternoUsado) return { ok: false, mensagem: 'Sem convênio do Amigoz resolvido para este item (rode a consulta de margem primeiro).' }

  const usaRcc = Number(item.margemBeneficioCompra) > 0
  const usaRmc = !usaRcc && Number(item.margemConsignado) > 0
  if (!usaRcc && !usaRmc) return { ok: false, mensagem: 'Sem margem de cartão (RCC/RMC) para criar o cliente.' }

  const convenio = Number.isFinite(Number(item.convenioExternoUsado)) ? Number(item.convenioExternoUsado) : item.convenioExternoUsado
  const body: Record<string, unknown> = {
    cpf: item.cpf,
    nome_cliente: item.nomeIf || item.nome || '',
    telefone,
    data_nascimento: item.nascimentoIf,
    escolaridade: ESCOLARIDADE_PADRAO,
    convenio_id: convenio,
    numero_matricula: item.matriculaIf || null,
    ...(usaRcc
      ? { tipo_produto: 7, tipo_margem: 1, margem: Number(item.margemBeneficioCompra) || 0, margem_saque: Number(item.margemBeneficioSaque) || 0 }
      : { tipo_produto: 15, tipo_margem: 3, margem: Number(item.margemConsignado) || 0, margem_saque: 0 }),
  }

  const r = await chamarAmigozAutenticado(cfg, 'criar-cliente', 'POST', '/api/cliente', body, criadoPor)
  const id = extrairClienteId(r.corpo)
  if (id) return { ok: true, clienteExternoId: id }
  return { ok: false, mensagem: `Falha ao criar cliente no Amigoz: ${mensagemErroAmigoz(r)}` }
}

export type ResultadoSimulacaoOfertas = {
  ofertas: OfertaNormalizada[]
  algumErro: string | null // última mensagem de erro/formato não reconhecido, se algum produto falhou (não derruba os outros)
}

/**
 * Uma `simulacao-cartao` por produto com margem > 0 (RCC e/ou RMC — nunca os
 * dois pro mesmo produto). `pausaMs` respeita o mesmo ritmo da consulta de
 * margem (pausa entre TODA chamada à API do Amigoz, não só entre itens).
 */
export async function simularOfertasAmigoz(
  cfg: ConfigAmigoz,
  item: Pick<ItemParaOferta, 'cpf' | 'nascimentoIf' | 'margemConsignado' | 'margemBeneficioCompra' | 'margemBeneficioSaque' | 'convenioExternoUsado'>,
  pausaMs: number,
  criadoPor?: string | null,
): Promise<ResultadoSimulacaoOfertas> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) throw new Error('Amigoz não está cadastrada em Instituições Financeiras.')
  const convenio = Number.isFinite(Number(item.convenioExternoUsado)) ? Number(item.convenioExternoUsado) : item.convenioExternoUsado

  const tentativas: Array<{ produto: ProdutoOferta; body: Record<string, unknown> }> = []
  if (Number(item.margemBeneficioCompra) > 0) {
    tentativas.push({
      produto: 'cartao_rcc',
      body: {
        cpf: item.cpf,
        convenio,
        tipo_produto: 7,
        tipo_margem: 1,
        margem: Number(item.margemBeneficioCompra),
        margem_saque: Number(item.margemBeneficioSaque) || 0,
        data_nascimento: item.nascimentoIf,
      },
    })
  }
  if (Number(item.margemConsignado) > 0) {
    tentativas.push({
      produto: 'cartao_rmc',
      body: { cpf: item.cpf, convenio, tipo_produto: 15, tipo_margem: 3, margem: Number(item.margemConsignado), margem_saque: 0, data_nascimento: item.nascimentoIf },
    })
  }

  const ofertas: OfertaNormalizada[] = []
  let algumErro: string | null = null
  for (const tentativa of tentativas) {
    await sleep(pausaMs)
    const r = await chamarAmigozAutenticado(cfg, 'simulacao-cartao', 'POST', '/api/simulacao/cartao', tentativa.body, criadoPor)
    if (!r.ok) {
      algumErro = mensagemErroAmigoz(r)
      continue
    }
    const oferta = normalizarOfertaAmigoz(tentativa.produto, r.corpo, inst)
    if (oferta) ofertas.push(oferta)
    else algumErro = 'Resposta da simulação em formato não reconhecido (ver bruto em if_credito_chamadas) — mapeamento ainda não calibrado com um caso de sucesso real.'
  }
  return { ofertas, algumErro }
}
