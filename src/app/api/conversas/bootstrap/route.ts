import { NextResponse } from 'next/server'
import { getBootstrapData } from '@/lib/central-conversas/actions'
import { PerformanceTimer } from '@/lib/performance/timing'

export async function GET() {
  const timer = new PerformanceTimer()
  try {
    timer.start('bootstrap')
    const data = await getBootstrapData()
    timer.end('bootstrap', 'Deduplicated Parallel Execution')

    return NextResponse.json(data, {
      headers: {
        'Server-Timing': timer.getServerTimingHeader(),
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Unauthorized' },
      { status: err?.message?.includes('Sem permissao') ? 403 : 401 },
    )
  }
}
