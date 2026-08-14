import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function cleanCnpj(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 14)
}

export async function GET(_: Request, ctx: { params: Promise<{ cnpj: string }> | { cnpj: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 })

  const params = await ctx.params
  const cnpj = cleanCnpj(params?.cnpj || '')

  if (cnpj.length !== 14) {
    return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 })
  }

  try {
    const response = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: '*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    })

    const contentType = response.headers.get('content-type') || ''
    const body = contentType.includes('application/json') ? await response.json() : await response.text()

    return NextResponse.json(body, { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao consultar CNPJ' }, { status: 502 })
  }
}
