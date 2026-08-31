'use client'

/** Picker caseiro simples — sem dependência externa, ~24 emojis comuns de atendimento. */
const EMOJIS = ['😀', '😂', '😉', '😍', '😢', '😮', '👍', '👎', '🙏', '🙌', '👏', '💪', '❤️', '🎉', '✅', '❌', '⏰', '📎', '📞', '💬', '🤝', '🔥', '👋', '🙂']

export default function EmojiPicker({ onSelecionar }: { onSelecionar: (emoji: string) => void }) {
  return (
    <div
      className="brs-messenger"
      style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, borderRadius: 6, padding: 8, width: 216, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, zIndex: 50, background: 'var(--msn-surface)', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }}
      data-brs-messenger-ignore-close="true"
    >
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onSelecionar(e)}
          style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--msn-item-hover)')}
          onMouseLeave={(ev) => (ev.currentTarget.style.background = 'none')}
        >
          {e}
        </button>
      ))}
    </div>
  )
}
