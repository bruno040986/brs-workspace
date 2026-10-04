/** Validação pura dos campos do card "API Meta" (sem imports de servidor). */
export type MetaCapiInput = { token?: string; testEventCode?: string; datasetId?: string; datasetNome?: string }

export function validarMetaCapi(i: MetaCapiInput): { ok: true; valor: Required<MetaCapiInput> } | { ok: false; erro: string } {
  const token = (i.token ?? '').trim()
  const testEventCode = (i.testEventCode ?? '').trim()
  const datasetId = (i.datasetId ?? '').trim()
  const datasetNome = (i.datasetNome ?? '').trim()
  if (token && (token.length > 600 || /\s/.test(token))) return { ok: false, erro: 'Token inválido (sem espaços ou quebras de linha, até 600 caracteres).' }
  if (testEventCode && !/^[A-Za-z0-9_-]{1,40}$/.test(testEventCode)) return { ok: false, erro: 'Código de evento de teste inválido (letras, números, _ e -, até 40).' }
  if (!/^\d{10,20}$/.test(datasetId)) return { ok: false, erro: 'ID do conjunto de dados deve ter de 10 a 20 dígitos.' }
  if (datasetNome.length > 120) return { ok: false, erro: 'Nome do conjunto de dados: até 120 caracteres.' }
  return { ok: true, valor: { token, testEventCode, datasetId, datasetNome } }
}
