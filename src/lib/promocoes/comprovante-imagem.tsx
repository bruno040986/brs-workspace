/**
 * Comprovante da promoção em PNG 1080×1350 (next/og, só servidor). Comprovante da inscrição do
 * indicador (números da sorte: comprovante-numeros-imagem.tsx). Sem marca BRS. Devolve o PNG como Buffer.
 */
import { ImageResponse } from 'next/og'
import { dataSorteioBr } from './mascara'

const AZUL = '#0b3d91'
const AZUL_CLARO = '#e8f0fe'
const TITULO = 'Você Sempre no Azul | Servidor Premiado'
const rodape = (sorteio?: string | null) => `iPhone 17e 256 GB · Loteria Federal ${dataSorteioBr(sorteio)} · Regulamento em nuazul.com.br`

export type DadosComprovante = {
  numeroIndicacao: string
  indicadorNome: string
  indicadoNome: string
  indicadoCpfMascarado: string
  contato: string
  sorteio?: string | null
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22 }}>
      <div style={{ display: 'flex', fontSize: 26, color: '#64748b', textTransform: 'uppercase', letterSpacing: 2 }}>{rotulo}</div>
      <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: '#0f172a' }}>{valor}</div>
    </div>
  )
}

function corpoIndicacao(d: DadosComprovante) {
  const passos = [
    'O servidor indicado deve falar com a NuAzul pelo WhatsApp e informar o número de indicação logo no início do atendimento.',
    'Vale a primeira indicação registrada para cada servidor.',
    'Quando o indicado concluir R$ 5.000 em crédito pago no período, você recebe R$ 50 por Pix.',
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#15803d' }}>Indicação registrada</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20, background: AZUL_CLARO, borderRadius: 24, padding: '24px 32px' }}>
        <div style={{ display: 'flex', fontSize: 26, color: '#475569', textTransform: 'uppercase', letterSpacing: 2 }}>Número de indicação</div>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, color: AZUL }}>{d.numeroIndicacao}</div>
      </div>
      <Linha rotulo="Servidor indicado" valor={d.indicadoNome} />
      <Linha rotulo="CPF do indicado" valor={d.indicadoCpfMascarado} />
      <Linha rotulo="Indicador" valor={d.indicadorNome} />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
        {passos.map((p, i) => (
          <div key={i} style={{ display: 'flex', fontSize: 28, color: '#334155', marginTop: 10, lineHeight: 1.3 }}>
            {`${i + 1}. ${p}`}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1 }} />
      {d.contato ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: AZUL, color: '#fff', borderRadius: 20, padding: '20px 24px', fontSize: 38, fontWeight: 700 }}>
          {`WhatsApp NuAzul: ${d.contato}`}
        </div>
      ) : null}
    </div>
  )
}

export async function gerarComprovanteImagem(d: DadosComprovante): Promise<Buffer> {
  const el = (
    <div style={{ width: 1080, height: 1350, display: 'flex', flexDirection: 'column', background: AZUL, padding: 36, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#fff', padding: '8px 0 28px' }}>
        <div style={{ display: 'flex', fontSize: 60, fontWeight: 800 }}>NuAzul</div>
        <div style={{ display: 'flex', fontSize: 30, textAlign: 'center' }}>Promoção</div>
        <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, textAlign: 'center' }}>{TITULO}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#fff', borderRadius: 36, padding: '36px 44px' }}>
        {corpoIndicacao(d)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', color: '#cbd5e1', fontSize: 24, marginTop: 22 }}>{rodape(d.sorteio)}</div>
    </div>
  )
  const resposta = new ImageResponse(el, { width: 1080, height: 1350 })
  return Buffer.from(await resposta.arrayBuffer())
}
