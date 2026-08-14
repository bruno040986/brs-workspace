// Sanitização de HTML rico salvo por usuários (ex.: comunicados) antes de persistir.
// Defesa contra XSS armazenado (M-5): o conteúdo é renderizado via
// dangerouslySetInnerHTML em várias telas, então limpamos na gravação.
//
// Abordagem conservadora por bloqueio: remove tags perigosas e seu conteúdo,
// atributos de evento (on*) e URLs javascript:. Não substitui um parser dedicado
// (DOMPurify), mas elimina os vetores práticos de script injetado.

const DANGEROUS_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'svg', 'math']

export function sanitizeRichHtml(input: string): string {
  let html = String(input || '')

  // Remove tags perigosas com todo o seu conteúdo (ex.: <script>...</script>).
  for (const tag of DANGEROUS_TAGS) {
    const withContent = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
    const selfClosing = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi')
    html = html.replace(withContent, '').replace(selfClosing, '')
  }

  // Remove atributos de evento inline: on...="..." / on...='...' / on...=valor.
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')

  // Neutraliza URLs javascript:/vbscript: em href/src.
  html = html.replace(/(href|src)\s*=\s*"(\s*(javascript|vbscript):[^"]*)"/gi, '$1="#"')
  html = html.replace(/(href|src)\s*=\s*'(\s*(javascript|vbscript):[^']*)'/gi, "$1='#'")

  return html
}
