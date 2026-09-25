/**
 * Documentos que identificam um cadastro de parceiro (fatia 2, 25/09/2026):
 * CNPJ da empresa (ou CPF do titular PF) + CPF de cada sócio PF, administrador
 * e testemunha. Só dígitos, sem repetição (o primeiro papel encontrado
 * prevalece). É o que vai para o índice `corban_onboarding_reprovacoes_docs`
 * e o que se cruza numa tentativa nova.
 *
 * Módulo folha (sem imports) para ser testável com `node --test`.
 */

export type DocumentoPapel = 'empresa' | 'titular' | 'socio' | 'administrador' | 'testemunha'

export type DocumentoDoCadastro = {
  /** Só dígitos. */
  documento: string
  tipo: 'cpf' | 'cnpj'
  papel: DocumentoPapel
  nome: string
}

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function coletarDocumentosDoCadastro(
  corbanData: Record<string, any> | null | undefined,
  personType: 'PF' | 'PJ',
  cpfCnpj: string,
): DocumentoDoCadastro[] {
  const data = corbanData || {}
  const out = new Map<string, DocumentoDoCadastro>()
  const add = (doc: unknown, tipo: 'cpf' | 'cnpj', papel: DocumentoPapel, nome: unknown) => {
    const d = digitos(doc)
    if (!d || out.has(d)) return
    out.set(d, { documento: d, tipo, papel, nome: String(nome || '').trim() })
  }
  const nomeMaster = data?.master?.name
  if (personType === 'PF') add(cpfCnpj, 'cpf', 'titular', nomeMaster)
  else add(cpfCnpj, 'cnpj', 'empresa', nomeMaster)
  const socios: any[] = Array.isArray(data?.socios) ? data.socios : []
  for (const s of socios) {
    if (s && typeof s === 'object' && (s.person_kind || 'PF') === 'PF') add(s.cpf, 'cpf', 'socio', s.name)
  }
  const administracao: any[] = Array.isArray(data?.administracao) ? data.administracao : []
  for (const a of administracao) {
    if (a && typeof a === 'object') add(a.cpf, 'cpf', 'administrador', a.name)
  }
  add(data?.witness?.cpf, 'cpf', 'testemunha', data?.witness?.name)
  return [...out.values()]
}
