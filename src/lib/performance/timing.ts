/**
 * Server-Timing utility for measuring operation durations in API Route Handlers
 * and Server Actions without leaking confidential data or message content.
 */

export type TimingMetric = {
  name: string
  description?: string
  durationMs: number
}

export class PerformanceTimer {
  private metrics: TimingMetric[] = []
  private startTimes: Map<string, number> = new Map()

  start(name: string) {
    this.startTimes.set(name, performance.now())
  }

  end(name: string, description?: string): number {
    const startTime = this.startTimes.get(name)
    if (startTime === undefined) return 0
    const duration = Math.max(0, performance.now() - startTime)
    this.metrics.push({ name, description, durationMs: duration })
    this.startTimes.delete(name)
    return duration
  }

  async time<T>(name: string, fn: () => Promise<T>, description?: string): Promise<T> {
    this.start(name)
    try {
      return await fn()
    } finally {
      this.end(name, description)
    }
  }

  getServerTimingHeader(): string {
    return this.metrics
      .map((m) => {
        const dur = m.durationMs.toFixed(2)
        const desc = m.description ? `;desc="${m.description.replace(/"/g, "'")}"` : ''
        return `${m.name}${desc};dur=${dur}`
      })
      .join(', ')
  }

  getMetrics(): TimingMetric[] {
    return [...this.metrics]
  }
}
