import type { Canais, Canal, DispatcherDb, EstadoFinal, Incidente, Intencao, Prioridade, ResultadoEnvio, Tentativa } from '../tipos.ts'

/** Banco em memória que imita a semântica do M05 (claim com lease, varredura de lease vencido, finish só do dono). */
export class FakeDb implements DispatcherDb {
  intencoes = new Map<string, Intencao & { estado: string; lease_owner: string | null; lease_until: number }>()
  tents: (Tentativa & { intencao_id: string })[] = []
  falhas: string[] = []
  orcamento: { permitido: boolean; motivo: string | null } = { permitido: true, motivo: null }
  resumoChamadas = 0
  falharAtualizar = false
  incidente_: Incidente = { codigo: 'INC-7', regra: 'login_reincidencia', gravidade: 'alta', versao_alerta: 1, eventos_total: 3, eventos_suprimidos: 0, agregado: false, janela_inicio: '2026-11-01T00:00:00Z', janela_fim: '2026-11-01T00:10:00Z' }
  finals: Record<string, { estado: EstadoFinal; retry?: Date }> = {}
  agora: () => Date
  constructor(agora: () => Date = () => new Date()) { this.agora = agora }

  add(id: string, prioridade: Prioridade = 'critica', tipo: Intencao['tipo'] = 'alerta') {
    this.intencoes.set(id, { id, incidente_id: 'inc-' + id, versao_alerta: 1, tipo, prioridade, criado_em: this.agora().toISOString(), estado: 'pendente', lease_owner: null, lease_until: 0 })
  }
  async claim(owner: string, limite: number) {
    const now = this.agora().getTime()
    for (const i of this.intencoes.values()) { // varredura (M05): lease vencido + tentativa 'enviando' => incerta; senão volta a pendente
      if (i.estado === 'em_envio' && i.lease_until < now) {
        const saiu = this.tents.some((t) => t.intencao_id === i.id && t.estado === 'enviando')
        i.estado = saiu ? 'incerta' : 'pendente'; i.lease_owner = null
        if (saiu) this.tents.filter((t) => t.intencao_id === i.id && t.estado === 'enviando').forEach((t) => (t.estado = 'incerta'))
      }
    }
    const out: Intencao[] = []
    for (const i of this.intencoes.values()) {
      if (out.length >= limite) break
      if (i.estado === 'pendente' && (!this.finals[i.id]?.retry || this.finals[i.id].retry!.getTime() <= now)) { i.estado = 'em_envio'; i.lease_owner = owner; i.lease_until = now + 120_000; out.push({ ...i }) } // SKIP LOCKED: o 2º claim não vê o que já está em_envio
    }
    return out
  }
  async incidente() { return this.incidente_ }
  async tentativas(id: string) { return this.tents.filter((t) => t.intencao_id === id).map((t) => ({ ...t })) }
  async preparar(id: string, owner: string, canal: Canal, ref: string, op: string) {
    const i = this.intencoes.get(id)!
    if (i.estado !== 'em_envio' || i.lease_owner !== owner || i.lease_until < this.agora().getTime()) throw new Error('seg_lease_perdido')
    const n = this.tents.filter((t) => t.intencao_id === id && t.canal === canal && t.config_ref === ref).length + 1
    const t = { id: `${id}-${this.tents.length}`, intencao_id: id, n, canal, config_ref: ref, operation_id: op, estado: 'enviando' as const, categoria_erro: null, retry_after_ate: null, criado_em: this.agora().toISOString() }
    this.tents.push(t)
    return { ...t }
  }
  async atualizarTentativa(id: string, patch: Partial<Tentativa>) {
    if (this.falharAtualizar) throw new Error('db fora')
    Object.assign(this.tents.find((t) => t.id === id)!, patch)
  }
  async finish(id: string, owner: string, estado: EstadoFinal, retry?: Date) {
    const i = this.intencoes.get(id)!
    if (i.lease_owner !== owner || i.lease_until < this.agora().getTime()) return false
    i.estado = estado; i.lease_owner = null; this.finals[id] = { estado, retry }
    return true
  }
  orcChamadas: [Canal, string][] = []
  async consumirOrcamento(canal: Canal, _inc: string, ref: string) { this.orcChamadas.push([canal, ref]); return this.orcamento }
  async config() { return {} }
  async resumoCriar() { this.resumoChamadas++; return { criado: true } }
  async resumoDados() { return { suprimidas_orcamento: 2, incertas: 1, falhas: 0, por_contingencia: 3 } }
  async falha(c: string) { this.falhas.push(c) }
}

export class FakeCanal {
  chamadas: { instanciaId?: string; texto?: string; operationId?: string; assunto?: string }[] = []
  respostas: ResultadoEnvio[] | ((n: number, a: { instanciaId?: string }) => ResultadoEnvio)
  constructor(respostas: ResultadoEnvio[] | ((n: number, a: { instanciaId?: string }) => ResultadoEnvio)) { this.respostas = respostas }
  async enviar(a: { texto?: string; instanciaId?: string; operationId?: string; assunto?: string }): Promise<ResultadoEnvio> {
    this.chamadas.push(a)
    const n = this.chamadas.length - 1
    return typeof this.respostas === 'function' ? this.respostas(n, a) : this.respostas[Math.min(n, this.respostas.length - 1)]
  }
}

export const OK: ResultadoEnvio = { tipo: 'aceita', messageId: 'm1' }
export const REJ: ResultadoEnvio = { tipo: 'rejeitada', categoria: 'instancia_inelegivel' }
export const INC: ResultadoEnvio = { tipo: 'incerta', categoria: 'timeout_ou_rede' }

export function canaisFake(o: { tg?: FakeCanal | null; wa?: FakeCanal | null; em?: FakeCanal | null; instancias?: string[] }): Canais {
  const inst = (o.instancias ?? ['i1', 'i2', 'i3']).map((instanciaId, k) => ({ ordem: k + 1, instanciaId }))
  return {
    telegram: { habilitado: Boolean(o.tg), adapter: (o.tg as never) ?? null },
    whatsapp: { habilitado: Boolean(o.wa), instancias: inst, adapter: (o.wa as never) ?? null },
    email: { habilitado: Boolean(o.em), adapter: (o.em as never) ?? null },
  }
}
