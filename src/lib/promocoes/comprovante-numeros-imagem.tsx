/**
 * Comprovante dos números da sorte em PNG (1080×1350) para o WhatsApp do participante.
 * ImageResponse (next/og), mesmo padrão do oferta-imagem do CRM. Só servidor.
 */
import { ImageResponse } from 'next/og'

export type DadosImagemNumeros = {
  nome: string
  numeros: string[]
  total: number
  contato: string | null
}

const AZUL = '#0b3d91'

export async function gerarImagemComprovanteNumeros(d: DadosImagemNumeros): Promise<Buffer> {
  const exibidos = d.numeros.slice(0, 12)
  const resto = d.numeros.length - exibidos.length
  const img = new ImageResponse(
    (
      <div style={{ width: 1080, height: 1350, display: 'flex', flexDirection: 'column', background: AZUL, color: '#fff', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', fontSize: 34, opacity: 0.85 }}>NuAzul – Você Sempre no Azul | Valparaíso de Goiás</div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, marginTop: 40 }}>Números da sorte gerados</div>
        <div style={{ display: 'flex', fontSize: 38, marginTop: 24, opacity: 0.9 }}>{d.nome}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 56, flex: 1, alignContent: 'flex-start' }}>
          {exibidos.map((n) => (
            <div key={n} style={{ display: 'flex', background: '#fff', color: AZUL, fontSize: 84, fontWeight: 700, padding: '16px 36px', borderRadius: 24, margin: 12 }}>
              {n}
            </div>
          ))}
          {resto > 0 ? <div style={{ display: 'flex', fontSize: 40, margin: 24 }}>{`+ ${resto} número(s)`}</div> : null}
        </div>
        <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>{`Total de números até agora: ${d.total}`}</div>
        <div style={{ display: 'flex', fontSize: 28, marginTop: 20, opacity: 0.85 }}>
          Sorteio pelo 1º prêmio da Loteria Federal de 11/11/2026. Guarde este comprovante.
        </div>
        {d.contato ? <div style={{ display: 'flex', fontSize: 28, marginTop: 12, opacity: 0.85 }}>{`Dúvidas: ${d.contato}`}</div> : null}
        <div style={{ display: 'flex', fontSize: 24, marginTop: 28, opacity: 0.7 }}>iPhone 17e 256 GB · Regulamento em nuazul.com.br</div>
      </div>
    ),
    { width: 1080, height: 1350 },
  )
  return Buffer.from(await img.arrayBuffer())
}
