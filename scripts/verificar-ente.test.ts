/**
 * Teste obrigatório da Fase 3 (roteiro, item 6): baixa o Decreto 11.731/2026
 * de verdade e confirma que a verificação do ente pega o caso real que
 * originou este pipeline — o texto é de Itajubá-MG, não de Cubatão/SP.
 * Rodar com: npx tsx scripts/verificar-ente.test.ts
 */
import { baixarSeguro } from '../src/lib/convenios/pesquisa/download-seguro'
import { extrairTexto, textoUtilSuficiente } from '../src/lib/convenios/pesquisa/extrair-texto'
import { verificarEnte } from '../src/lib/convenios/pesquisa/verificar-ente'

const URL_DECRETO = 'https://www.dosp.com.br/exibe_doc.php?i=MjU1NzI2Ng%3D%3D'

let falhas = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  OK  — ${msg}`)
  } else {
    falhas++
    console.error(`FALHA — ${msg}`)
  }
}

async function main() {
  console.log(`Baixando ${URL_DECRETO} ...`)
  const { bytes, mime, urlFinal } = await baixarSeguro(URL_DECRETO)
  assert(mime === 'application/pdf', `mime detectado é PDF (veio "${mime}")`)
  console.log(`  ${bytes.length} bytes, urlFinal=${urlFinal}`)

  const { texto, paginas } = await extrairTexto(bytes, mime)
  assert(textoUtilSuficiente(texto), `texto extraído tem conteúdo útil (${texto.length} chars, ${paginas} páginas)`)
  assert(/itajub/i.test(texto), 'o texto extraído menciona "Itajubá" (confirma que o parser de PDF está lendo o corpo do decreto)')

  console.log('\n--- Contra convênio de Cubatão/SP (o caso real que travou o Gemini) ---')
  const cubatao = verificarEnte(texto, { abrangencia: 'municipal', cidade: 'Cubatão', uf: 'SP' })
  console.log('  resultado:', cubatao)
  assert(cubatao.status === 'ente_divergente', `status é ente_divergente (veio "${cubatao.status}")`)
  assert(/itajub/i.test(cubatao.motivo), `motivo cita Itajubá (veio "${cubatao.motivo}")`)

  console.log('\n--- Contra convênio de Itajubá/MG (o ente real do decreto) ---')
  const itajuba = verificarEnte(texto, { abrangencia: 'municipal', cidade: 'Itajubá', uf: 'MG' })
  console.log('  resultado:', itajuba)
  assert(itajuba.status === 'verificada', `status é verificada (veio "${itajuba.status}")`)

  console.log('\n--- Sanidade: convênio nacional não deve "verificar" contra texto municipal ---')
  const nacional = verificarEnte(texto, { abrangencia: 'nacional', cidade: null, uf: null })
  console.log('  resultado:', nacional)
  assert(nacional.status === 'ente_divergente', `status é ente_divergente (veio "${nacional.status}")`)

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Erro fatal no teste:', err)
  process.exit(1)
})
