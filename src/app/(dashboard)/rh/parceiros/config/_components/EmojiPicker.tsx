'use client'

import { useMemo, useState } from 'react'
import { Smile, X, Search } from 'lucide-react'

/**
 * Seletor de emojis (self-contained, sem dependência externa).
 *
 * Um botão que abre um overlay com abas por categoria e busca por nome. Cobre
 * as categorias do WhatsApp com um conjunto amplo dos emojis mais usados.
 * Clicar insere o emoji via `onPick`.
 */

type EmojiCategory = {
  key: string
  label: string
  icon: string
  emojis: string[]
}

// Conjunto amplo por categoria (os mais usados de cada grupo do WhatsApp).
const CATEGORIES: EmojiCategory[] = [
  {
    key: 'smileys',
    label: 'Smileys e emoções',
    icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','😂','🤣','🥲','☺️','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👻','💀','☠️','👽','🤖','💩','🎃',
    ],
  },
  {
    key: 'gestures',
    label: 'Pessoas e gestos',
    icon: '👍',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','👃','🧠','🫀','🫁','🦷','👀','👁️','👅','👄','💋','🧑','👶','👦','👧','👨','👩','🧓','👴','👵','🙇','💁','🙅','🙆','🙋','🧏','🤦','🤷','👮','🕵️','💂','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟',
    ],
  },
  {
    key: 'nature',
    label: 'Animais e natureza',
    icon: '🐶',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🦚','🦜','🦢','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🌾','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌚','🌙','⭐','🌟','✨','⚡','☄️','💥','🔥','🌈','☀️','⛅','☁️','🌧️','⛈️','🌨️','❄️','☃️','💧','🌊',
    ],
  },
  {
    key: 'food',
    label: 'Comida e bebida',
    icon: '🍔',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾',
    ],
  },
  {
    key: 'activities',
    label: 'Atividades',
    icon: '⚽',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩',
    ],
  },
  {
    key: 'travel',
    label: 'Viagem e lugares',
    icon: '🚗',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','⛽','🚧','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️',
    ],
  },
  {
    key: 'objects',
    label: 'Objetos',
    icon: '💡',
    emojis: [
      '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','💰','💳','🧾','💎','⚖️','🧰','🔧','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','⚱️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳️','💊','💉','🩸','🩹','🩺','🌡️','🧬','🦠','🧫','🧪','🧹','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪒','🧽','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛎️','🧸','🖼️','🛍️','🛒','🎁','🎈','🎏','🎀','🎊','🎉','🪅','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','📊','📈','📉','🗒️','🗓️','📆','📅','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓',
    ],
  },
  {
    key: 'symbols',
    label: 'Símbolos',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','➕','➖','➗','✖️','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','⚪','⚫','🔴','🔵','🟤','🟣','🟢','🟡','🟠','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','⬛','⬜','🟥','🟧','🟨','🟩','🟦','🟪','🟫',
    ],
  },
]

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(CATEGORIES[0].key)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (q) {
      // Busca simples: junta todas as categorias (emoji não tem nome aqui, então
      // filtra por categoria cujo rótulo casa OU mostra tudo se o termo for curto).
      const matchCats = CATEGORIES.filter((c) => c.label.toLowerCase().includes(q))
      if (matchCats.length > 0) return matchCats.flatMap((c) => c.emojis)
      return CATEGORIES.flatMap((c) => c.emojis)
    }
    return CATEGORIES.find((c) => c.key === active)?.emojis || []
  }, [q, active])

  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        title="Inserir emoji"
        onClick={() => setOpen(true)}
        style={{ padding: '2px 10px' }}
      >
        <Smile size={16} />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, width: 'min(460px, 96vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.85rem', borderBottom: '1px solid var(--brs-gray-100)' }}>
              <Smile size={18} style={{ color: 'var(--brs-navy)' }} />
              <strong style={{ flex: 1, color: 'var(--brs-gray-800)' }}>Emojis</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '0.6rem 0.85rem 0' }}>
              <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar categoria…"
                  className="form-control"
                  style={{ paddingLeft: 32, height: 34 }}
                />
              </div>
              {!q && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      title={c.label}
                      onClick={() => setActive(c.key)}
                      style={{
                        fontSize: '1.15rem',
                        lineHeight: 1,
                        padding: '4px 6px',
                        borderRadius: 6,
                        border: '1px solid ' + (active === c.key ? 'var(--brs-navy)' : 'transparent'),
                        background: active === c.key ? 'var(--brs-primary-50)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {c.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ overflowY: 'auto', padding: '0.25rem 0.85rem 0.85rem' }}>
              {!q && (
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)', margin: '0.35rem 0' }}>
                  {CATEGORIES.find((c) => c.key === active)?.label}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: '2px' }}>
                {visible.map((emo, i) => (
                  <button
                    key={`${emo}-${i}`}
                    type="button"
                    onClick={() => { onPick(emo); setOpen(false) }}
                    style={{ fontSize: '1.35rem', lineHeight: 1, padding: '4px 0', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brs-gray-100)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {emo}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
