'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play } from 'lucide-react'

type AudioPlayerProps = {
  src: string
  onLoadedData?: () => void
  isMine?: boolean
}

function formatarTempo(segundos: number): string {
  if (isNaN(segundos) || segundos < 0) return '00:00'
  const min = Math.floor(segundos / 60)
  const seg = Math.floor(segundos % 60)
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`
}

export default function AudioPlayer({ src, onLoadedData, isMine = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState<number>(1)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
      if (onLoadedData) onLoadedData()
    }
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
    }
  }, [onLoadedData])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio) return
    const novoTempo = parseFloat(e.target.value)
    audio.currentTime = novoTempo
    setCurrentTime(novoTempo)
  }

  function toggleSpeed() {
    const audio = audioRef.current
    if (!audio) return
    const velocidades = [1, 1.5, 2]
    const proxima = velocidades[(velocidades.indexOf(speed) + 1) % velocidades.length]
    audio.playbackRate = proxima
    setSpeed(proxima)
  }

  const progressoPorcento = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 16,
        background: isMine ? 'rgba(255, 255, 255, 0.25)' : 'var(--msn-surface-alt, #f8fafc)',
        border: '1px solid var(--msn-soft-border, rgba(0, 0, 0, 0.08))',
        minWidth: 240,
        maxWidth: 320,
        marginBottom: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Ícone de Microfone / Indicador de Voz */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 99,
          background: isMine ? 'var(--msn-accent, #10b981)' : 'rgba(16, 185, 129, 0.15)',
          color: isMine ? '#fff' : '#059669',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <Mic size={18} />
      </div>

      {/* Botão de Play / Pause */}
      <button
        type="button"
        onClick={togglePlay}
        style={{
          width: 32,
          height: 32,
          borderRadius: 99,
          background: isMine ? 'rgba(0,0,0,0.1)' : 'var(--msn-surface, #fff)',
          border: '1px solid var(--msn-soft-border, #e2e8f0)',
          color: isMine ? '#fff' : 'var(--msn-text, #1e293b)',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          padding: 0,
          transition: 'transform 0.1s ease',
        }}
        title={isPlaying ? 'Pausar' : 'Reproduzir'}
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>

      {/* Barra de Progresso e Tempo */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 16 }}>
          {/* Trilha do Slider */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            style={{
              width: '100%',
              height: 4,
              borderRadius: 99,
              appearance: 'none',
              WebkitAppearance: 'none',
              background: `linear-gradient(to right, ${isMine ? '#fff' : 'var(--msn-accent, #10b981)'} ${progressoPorcento}%, ${
                isMine ? 'rgba(255,255,255,0.4)' : '#cbd5e1'
              } ${progressoPorcento}%)`,
              outline: 'none',
              cursor: 'pointer',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 600, color: isMine ? 'rgba(255,255,255,0.9)' : 'var(--msn-muted, #64748b)' }}>
          <span>{formatarTempo(currentTime)}</span>
          <span>{formatarTempo(duration)}</span>
        </div>
      </div>

      {/* Botão de Velocidade (1x / 1.5x / 2x) */}
      <button
        type="button"
        onClick={toggleSpeed}
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          padding: '2px 6px',
          borderRadius: 99,
          background: isMine ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)',
          color: isMine ? '#fff' : 'var(--msn-text, #334155)',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
        title="Alternar velocidade de reprodução"
      >
        {speed}x
      </button>
    </div>
  )
}
