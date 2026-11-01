import { describe, it } from 'node:test'
import assert from 'node:assert'
import { extrairPathDocumento, resolverDocumentoDoAgente, nomeArquivoSeguro, urlDocumentoParceiro } from '../agente-corban-documento.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const U = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const cd = {
  documents: { bank_proof_url: 'https://p.supabase.co/storage/v1/object/public/partner-documents/123/bank/1_a%20b.pdf', front_photo_url: `rascunhos/${B}/front/${U}.jpg` },
  socios: [{ document_url: `rascunhos/${B}/socio/${U}.png` }],
}

describe('documento do parceiro', () => {
  it('extrai path de URL antiga e recusa externos/bucket errado', () => {
    assert.equal(extrairPathDocumento(cd.documents.bank_proof_url), '123/bank/1_a b.pdf')
    for (const ruim of ['https://evil.example/x.pdf', 'https://p.supabase.co/storage/v1/object/public/outro/x.pdf', 'javascript:alert(1)', 'data:text/html,x', 'a/../b.pdf', 'a/%2e%2e/b.pdf', '//evil/x', '']) {
      assert.equal(extrairPathDocumento(ruim), null, ruim)
    }
  })
  it('rejeita traversal/percent-encoding em qualquer ramo e aceita nome real', () => {
    const base = 'https://p.supabase.co/storage/v1/object/public/partner-documents/'
    for (const ruim of [base + 'a/%252e%252e/b.pdf', base + 'a/%2e%2e/b.pdf', base + 'a%2f..%2fb.pdf', base + 'a/b%25.pdf', base + 'a//b.pdf', base + 'a/./b.pdf', base + 'a/%2e/b.pdf',
      './a/b.pdf', 'a/./b.pdf', 'a//b.pdf', 'a/b/', 'a/b%20c.pdf', 'a/%252e%252e/b.pdf', 'a/b\\c.pdf', 'a/b?x.pdf', 'a/b#x.pdf', 'a/b\0.pdf', '../a.pdf', 'a/<b>.pdf']) {
      assert.equal(extrairPathDocumento(ruim), null, ruim)
    }
    assert.equal(extrairPathDocumento(base + '123/bank/1_Comprovante%20de%20Endere%C3%A7o%20(2).pdf'), '123/bank/1_Comprovante de Endereço (2).pdf')
    assert.equal(extrairPathDocumento('123/bank/1_Comprovante de Endereço (2).pdf'), '123/bank/1_Comprovante de Endereço (2).pdf')
    assert.equal(extrairPathDocumento('123/bank/2_RG, CPF.pdf'), '123/bank/2_RG, CPF.pdf')
    assert.equal(extrairPathDocumento(`/correcao/${A}/k/${U}.pdf`), `correcao/${A}/k/${U}.pdf`)
  })
  it('só serve o que o próprio agente referencia', () => {
    assert.equal(resolverDocumentoDoAgente(cd, A, cd.documents.bank_proof_url), '123/bank/1_a b.pdf')
    assert.equal(resolverDocumentoDoAgente(cd, A, `rascunhos/${B}/socio/${U}.png`), `rascunhos/${B}/socio/${U}.png`) // sócio
    assert.equal(resolverDocumentoDoAgente(cd, A, `correcao/${A}/k/${U}.pdf`), `correcao/${A}/k/${U}.pdf`)
    assert.equal(resolverDocumentoDoAgente(cd, A, `correcao/${B}/k/${U}.pdf`), null) // correção de outro agente
    assert.equal(resolverDocumentoDoAgente(cd, A, `correcao/${A}/../${B}/k/x.pdf`), null) // traversal no atalho
    assert.equal(resolverDocumentoDoAgente(cd, A, `correcao/${A}/%2e%2e/x.pdf`), null)
    assert.equal(resolverDocumentoDoAgente(cd, A, '999/outro/x.pdf'), null) // fora do corban_data
    assert.equal(resolverDocumentoDoAgente(cd, 'nao-uuid', cd.documents.front_photo_url), null)
  })
  it('nome seguro e URL da UI', () => {
    assert.equal(nomeArquivoSeguro('a/b/x"\r\n y.pdf'), 'x____y.pdf')
    assert.equal(nomeArquivoSeguro('a/..'), 'documento')
    assert.equal(urlDocumentoParceiro(A, 'https://externo.com/a.pdf'), 'https://externo.com/a.pdf')
    assert.ok(urlDocumentoParceiro(A, `rascunhos/${B}/f/${U}.jpg`).startsWith(`/api/agente-corban/documento?agente=${A}&ref=`))
  })
})
