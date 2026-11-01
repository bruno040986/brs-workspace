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
  it('só serve o que o próprio agente referencia', () => {
    assert.equal(resolverDocumentoDoAgente(cd, A, cd.documents.bank_proof_url), '123/bank/1_a b.pdf')
    assert.equal(resolverDocumentoDoAgente(cd, A, `rascunhos/${B}/socio/${U}.png`), `rascunhos/${B}/socio/${U}.png`) // sócio
    assert.equal(resolverDocumentoDoAgente(cd, A, `correcao/${A}/k/${U}.pdf`), `correcao/${A}/k/${U}.pdf`)
    assert.equal(resolverDocumentoDoAgente(cd, A, `correcao/${B}/k/${U}.pdf`), null) // correção de outro agente
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
