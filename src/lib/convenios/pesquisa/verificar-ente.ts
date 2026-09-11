/**
 * Convênio — Base de Conhecimento, Fase 3. Verificação do ente — spec §6.2
 * passo 3: DETERMINÍSTICA, sem IA. É esta checagem que teria barrado o caso
 * real que originou a Fase 3 (10/09/2026): o Gemini citou como sendo de
 * Cubatão/SP um decreto que, no texto, é de Itajubá-MG.
 */

export type EnteStatus = 'verificada' | 'ente_divergente' | 'nao_verificada'

export type VerificacaoEnte = {
  status: EnteStatus
  enteDetectado: string | null
  ufDetectada: string | null
  motivo: string
}

const UF_NOME: Record<string, string> = {
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara',
  DF: 'distrito federal', ES: 'espirito santo', GO: 'goias', MA: 'maranhao', MT: 'mato grosso',
  MS: 'mato grosso do sul', MG: 'minas gerais', PA: 'para', PB: 'paraiba', PR: 'parana',
  PE: 'pernambuco', PI: 'piaui', RJ: 'rio de janeiro', RN: 'rio grande do norte',
  RS: 'rio grande do sul', RO: 'rondonia', RR: 'roraima', SC: 'santa catarina',
  SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins',
}

// Faixa Unicode dos diacríticos combinantes deixados por normalize('NFD')
// (U+0300–U+036F), construída por código de caractere — evita depender de o
// arquivo-fonte preservar corretamente uma marca combinante invisível colada
// direto no código.
const REGEX_DIACRITICOS = new RegExp(
  String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d),
  'g',
)

function semAcento(s: string): string {
  return s.normalize('NFD').replace(REGEX_DIACRITICOS, '')
}

function normalizar(s: string): string {
  return semAcento(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim()
}

function capitalizarPalavras(s: string): string {
  return s.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * Acha ocorrências de `padraoBase` (deve terminar em "de " / "municipal de "
 * etc.) e devolve o nome que vem logo depois, até a primeira pontuação forte
 * ou ~60 caracteres — ex.: "Prefeito Municipal de Itajubá," → "itajuba".
 */
function extrairNomesApos(texto: string, padraoBase: string): string[] {
  const regex = new RegExp(padraoBase, 'g')
  const nomes: string[] = []
  let m: RegExpExecArray | null
  let iteracoes = 0
  while ((m = regex.exec(texto)) && iteracoes < 500) {
    iteracoes++
    const resto = texto.slice(m.index + m[0].length, m.index + m[0].length + 60)
    const nome = resto.split(/[,.;\n]/)[0].trim()
    if (nome && nome.length <= 50) nomes.push(nome)
  }
  return nomes
}

function nomeMaisFrequente(nomes: string[]): string {
  const contagem = new Map<string, number>()
  for (const n of nomes) contagem.set(n, (contagem.get(n) || 0) + 1)
  let melhor = nomes[0] || ''
  let max = 0
  for (const [n, c] of contagem) {
    if (c > max) {
      max = c
      melhor = n
    }
  }
  return melhor
}

export function verificarEnte(
  textoOriginal: string,
  convenio: { abrangencia: string; cidade: string | null; uf: string | null },
): VerificacaoEnte {
  const texto = normalizar(textoOriginal)

  const nomesMunicipais = [
    ...extrairNomesApos(texto, 'prefeitura (?:municipal )?de '),
    ...extrairNomesApos(texto, 'municipio de '),
    ...extrairNomesApos(texto, 'camara municipal de '),
    ...extrairNomesApos(texto, 'prefeito(?:\\(a\\))? (?:municipal )?de '),
  ]
  const nomesEstaduais = [
    ...extrairNomesApos(texto, 'governo do estado de '),
    ...extrairNomesApos(texto, 'estado de '),
  ]
  // Achado real (11/09/2026): normas federais sobre consignação raramente
  // dizem "presidente da república" ou "união federal" no corpo — o que
  // aparece de verdade é "Poder Executivo federal", "servidores públicos
  // federais", "administração pública federal" etc. Sem esses padrões, uma
  // Portaria/Decreto claramente federal caía em "não verificada" (sinal
  // fraco demais) em vez do "ente_divergente" correto e mais informativo.
  const ocorrenciasFederal = (
    texto.match(
      /presidente da republica|congresso nacional|uniao federal|poder executivo federal|administracao publica federal|servidor(?:es)? publico(?:s)? federa(?:l|is)|governo federal|\bda uniao\b/g,
    ) || []
  ).length

  const contagemMunicipal = nomesMunicipais.length
  const contagemEstadual = nomesEstaduais.length

  if (contagemMunicipal === 0 && contagemEstadual === 0 && ocorrenciasFederal === 0) {
    return {
      status: 'nao_verificada',
      enteDetectado: null,
      ufDetectada: null,
      motivo: 'Não foi possível identificar o ente (prefeitura/estado/união) no texto — confira manualmente.',
    }
  }

  let tipoDetectado: 'municipal' | 'estadual' | 'federal'
  if (contagemMunicipal > 0 && contagemMunicipal >= contagemEstadual && contagemMunicipal >= ocorrenciasFederal) {
    tipoDetectado = 'municipal'
  } else if (contagemEstadual > 0 && contagemEstadual >= ocorrenciasFederal) {
    tipoDetectado = 'estadual'
  } else {
    tipoDetectado = 'federal'
  }

  const cidadeConvenio = normalizar(convenio.cidade || '')
  const ufConvenio = String(convenio.uf || '').toUpperCase()
  const nomeEstadoConvenio = UF_NOME[ufConvenio] || ''

  if (tipoDetectado === 'municipal') {
    const nomeMaisComum = nomeMaisFrequente(nomesMunicipais)
    const rotulo = capitalizarPalavras(nomeMaisComum)
    if (convenio.abrangencia !== 'municipal') {
      return { status: 'ente_divergente', enteDetectado: nomeMaisComum, ufDetectada: null, motivo: `O texto parece ser de um município (${rotulo}), mas este convênio não é municipal.` }
    }
    if (!cidadeConvenio) {
      return { status: 'nao_verificada', enteDetectado: nomeMaisComum, ufDetectada: null, motivo: `Texto cita o município ${rotulo}, mas o convênio não tem cidade cadastrada para conferir.` }
    }
    if (nomeMaisComum.includes(cidadeConvenio) || cidadeConvenio.includes(nomeMaisComum)) {
      return { status: 'verificada', enteDetectado: nomeMaisComum, ufDetectada: ufConvenio || null, motivo: `O texto confirma o município de ${rotulo}.` }
    }
    return { status: 'ente_divergente', enteDetectado: nomeMaisComum, ufDetectada: null, motivo: `O texto é de outro município (${rotulo}), não de ${convenio.cidade}.` }
  }

  if (tipoDetectado === 'estadual') {
    const nomeMaisComum = nomeMaisFrequente(nomesEstaduais)
    const rotulo = capitalizarPalavras(nomeMaisComum)
    if (convenio.abrangencia !== 'estadual') {
      return { status: 'ente_divergente', enteDetectado: nomeMaisComum, ufDetectada: null, motivo: `O texto parece ser de um estado (${rotulo}), mas este convênio não é estadual.` }
    }
    if (!nomeEstadoConvenio) {
      return { status: 'nao_verificada', enteDetectado: nomeMaisComum, ufDetectada: null, motivo: `Texto cita o estado de ${rotulo}, mas o convênio não tem UF cadastrada para conferir.` }
    }
    if (nomeMaisComum.includes(nomeEstadoConvenio) || nomeEstadoConvenio.includes(nomeMaisComum)) {
      return { status: 'verificada', enteDetectado: nomeMaisComum, ufDetectada: ufConvenio, motivo: `O texto confirma o estado de ${rotulo}.` }
    }
    return { status: 'ente_divergente', enteDetectado: nomeMaisComum, ufDetectada: null, motivo: `O texto é de outro estado (${rotulo}), não de ${capitalizarPalavras(nomeEstadoConvenio)}.` }
  }

  // federal
  if (convenio.abrangencia !== 'nacional') {
    return { status: 'ente_divergente', enteDetectado: 'federal', ufDetectada: null, motivo: 'O texto parece ser uma norma federal, mas este convênio não é de abrangência nacional.' }
  }
  return { status: 'verificada', enteDetectado: 'federal', ufDetectada: null, motivo: 'O texto confirma ser uma norma federal.' }
}
