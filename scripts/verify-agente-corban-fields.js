/**
 * Verificação executável do dicionário canônico de campos do Agente Corban.
 *
 * O projeto não tem suíte de testes, e `tsc --noEmit` só prova que compila.
 * Este script roda o código de verdade contra dados realistas.
 *
 * COMO RODAR (a partir da raiz do projeto):
 *
 *   1. Compilar os módulos para JS (o alias @/ não resolve fora do Next, por isso
 *      os três arquivos vão juntos; o erro TS2307 do alias é esperado e inofensivo):
 *
 *      npx tsc src/lib/agente-corban-fields.ts src/lib/agente-corban.ts \
 *        src/lib/company-bank-accounts.ts \
 *        --outDir /tmp/acf-build --module commonjs --target ES2020 \
 *        --moduleResolution node --skipLibCheck --esModuleInterop
 *
 *   2. Rodar:
 *
 *      BUILD_DIR=/tmp/acf-build NODE_PATH=./node_modules \
 *        node scripts/verify-agente-corban-fields.js
 *
 * Sai com código 0 se tudo passar, 1 caso contrário.
 */

const path = require('path')
const Module = require('module')

const BUILD = process.env.BUILD_DIR || '/tmp/acf-build'

// Resolve o alias '@/lib/x' do projeto para o build local.
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/lib/')) {
    return path.join(BUILD, request.replace('@/lib/', '') + '.js')
  }
  return originalResolve.call(this, request, ...rest)
}

let F
try {
  F = require(path.join(BUILD, 'agente-corban-fields.js'))
} catch (err) {
  console.error(`\n✗ Não consegui carregar o build em ${BUILD}`)
  console.error('  Rode o passo 1 do cabeçalho deste arquivo primeiro.\n')
  console.error(`  ${err.message}\n`)
  process.exit(1)
}

let pass = 0
let fail = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  failures.push(`  ✗ ${name}\n      esperado: ${e}\n      obtido:   ${a}`)
}

function ok(name, condition, detail = '') {
  if (condition) { pass++; return }
  fail++
  failures.push(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`)
}

// -------------------------------------------------------------------------
console.log('\n### 1. Integridade do dicionário')
// -------------------------------------------------------------------------
const keys = F.AGENTE_CORBAN_FIELDS.map((f) => f.key)
const paths = F.AGENTE_CORBAN_FIELDS.map((f) => f.path)
const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i)
const dupPaths = paths.filter((p, i) => paths.indexOf(p) !== i)

ok('sem system_key duplicado', dupKeys.length === 0, `duplicados: ${dupKeys}`)
ok('sem path duplicado', dupPaths.length === 0, `duplicados: ${dupPaths}`)
ok('todo campo tem label', F.AGENTE_CORBAN_FIELDS.every((f) => !!f.label))
ok('todo path começa por uma seção conhecida', F.AGENTE_CORBAN_FIELDS.every((f) =>
  ['master', 'contacts', 'address', 'socios', 'witness', 'bank', 'access', 'documents', 'consent']
    .includes(f.path.split('.')[0])))
console.log(`    ${F.AGENTE_CORBAN_FIELDS.length} campos no dicionário`)

// -------------------------------------------------------------------------
console.log('\n### 2. Cobertura dos system_key herdados do construtor')
// -------------------------------------------------------------------------
// Lista congelada do que a constante SYSTEM_KEYS oferecia antes da migração para
// o dicionário. Serve de trava: nenhum vínculo antigo pode deixar de existir.
const LEGADO = ['address_city','address_complement','address_neighborhood','address_number',
'address_state','address_street','bank_account','bank_account_type','bank_agency','bank_name',
'birth_date','cep','cnae_main_code','cnae_main_desc','commission_receive_type',
'company_capital_social','company_country','company_legal_nature','company_opening_date',
'company_registration_status','company_size','cpf_cnpj','email_comissao','email_financeiro',
'email_formalizacao','email_juridico','fantasy_name','name','partner_1_address_city',
'partner_1_address_complement','partner_1_address_neighborhood','partner_1_address_number',
'partner_1_address_state','partner_1_address_street','partner_1_birth_date','partner_1_cep',
'partner_1_cpf','partner_1_email','partner_1_name','partner_1_whatsapp','partner_2_birth_date',
'partner_2_cpf','partner_2_email','partner_2_name','partner_2_whatsapp','payment_period',
'person_type','phone_commercial','phone_support','phone_whatsapp','phone_whatsapp_financeiro',
'pix_key','pix_type','representante_legal','rg','rg_expedition_date','rg_issuer','rg_state',
'signature_email','signature_whatsapp']

const semCobertura = LEGADO.filter((k) => !F.getFieldByKey(k))
ok('todo system_key herdado tem lugar no dicionário', semCobertura.length === 0,
   `sem cobertura: ${semCobertura.join(', ')}`)
console.log(`    ${LEGADO.length} chaves herdadas verificadas`)

// -------------------------------------------------------------------------
console.log('\n### 3. setValueAtPath / getValueAtPath')
// -------------------------------------------------------------------------
check('cria objeto aninhado', F.setValueAtPath({}, 'master.name', 'ACME'), { master: { name: 'ACME' } })
check('cria array a partir de índice', F.setValueAtPath({}, 'socios.0.name', 'João'), { socios: [{ name: 'João' }] })
check('cria buraco no array quando índice > 0',
  F.setValueAtPath({}, 'socios.1.name', 'Maria').socios.length, 2)
check('lê caminho aninhado', F.getValueAtPath({ master: { name: 'ACME' } }, 'master.name'), 'ACME')
check('lê dentro de array', F.getValueAtPath({ socios: [{ name: 'João' }] }, 'socios.0.name'), 'João')
check('caminho inexistente devolve undefined', F.getValueAtPath({}, 'a.b.c'), undefined)

const original = { master: { name: 'ACME', cpf_cnpj: '123' } }
const mutated = F.setValueAtPath(original, 'master.name', 'NOVO')
check('não muta a origem', original.master.name, 'ACME')
check('devolve cópia alterada', mutated.master.name, 'NOVO')
check('preserva irmãos', mutated.master.cpf_cnpj, '123')

// -------------------------------------------------------------------------
console.log('\n### 4. Roteamento de um formulário PJ real')
// -------------------------------------------------------------------------
const respostas = {
  person_type: 'PJ',
  cpf_cnpj: '12.345.678/0001-90',
  name: 'ACME Correspondente LTDA',
  fantasy_name: 'ACME',
  email_comissao: '  Financeiro@ACME.com.BR ',
  phone_whatsapp: '(11) 98765-4321',
  cep: '01310-100',
  address_state: 'sp',
  partner_1_name: 'João da Silva',
  partner_1_cpf: '111.222.333-44',
  partner_1_email: 'joao@acme.com.br',
  partner_2_exists: 'false',
  lgpd_consent: 'true',
  pergunta_livre_do_formulario: 'resposta qualquer',
}

const r = F.routeFormAnswersToCorbanData(respostas, {})
check('CNPJ normalizado (só dígitos)', F.getValueAtPath(r.corbanData, 'master.cpf_cnpj'), '12345678000190')
check('e-mail normalizado', F.getValueAtPath(r.corbanData, 'contacts.email_comissao'), 'financeiro@acme.com.br')
check('telefone normalizado', F.getValueAtPath(r.corbanData, 'contacts.phone_whatsapp'), '11987654321')
check('CEP normalizado', F.getValueAtPath(r.corbanData, 'address.cep'), '01310100')
check('UF em maiúscula', F.getValueAtPath(r.corbanData, 'address.address_state'), 'SP')
check('sócio principal roteado', F.getValueAtPath(r.corbanData, 'socios.0.name'), 'João da Silva')
check('sócio 0 marcado como principal', F.getValueAtPath(r.corbanData, 'socios.0.is_principal'), true)
check('boolean convertido', F.getValueAtPath(r.corbanData, 'consent.lgpd'), true)
check('boolean "false" vira false', F.getValueAtPath(r.corbanData, 'master.has_secondary_socio'), false)
check('resposta livre vai para additional_data', r.additionalData.pergunta_livre_do_formulario, 'resposta qualquer')
check('chave desconhecida é sinalizada', r.unmappedKeys, ['pergunta_livre_do_formulario'])

// -------------------------------------------------------------------------
console.log('\n### 5. Reenvio parcial não apaga dado existente')
// -------------------------------------------------------------------------
const parcial = F.routeFormAnswersToCorbanData({ name: '', email_comissao: 'novo@acme.com' }, r.corbanData)
check('string vazia não sobrescreve', F.getValueAtPath(parcial.corbanData, 'master.name'), 'ACME Correspondente LTDA')
check('valor novo sobrescreve', F.getValueAtPath(parcial.corbanData, 'contacts.email_comissao'), 'novo@acme.com')
check('seções não tocadas sobrevivem', F.getValueAtPath(parcial.corbanData, 'socios.0.name'), 'João da Silva')

// -------------------------------------------------------------------------
console.log('\n### 6. Portão da etapa ARW')
// -------------------------------------------------------------------------
const arwKeys = F.getArwReturnFields().map((f) => f.key)
ok('aba Acesso expõe arw_code e senha', arwKeys.includes('arw_code') && arwKeys.includes('temporary_password'))

const semArw = F.findMissingFields(r.corbanData, ['arw_code', 'temporary_password'])
check('etapa bloqueada sem dados do ARW', semArw.map((m) => m.key), ['arw_code', 'temporary_password'])

const comArw = F.setValueAtPath(
  F.setValueAtPath(r.corbanData, 'access.arw_code', 'SP0001'),
  'access.temporary_password', 'brs123')
check('etapa liberada com dados do ARW', F.findMissingFields(comArw, ['arw_code', 'temporary_password']), [])

// -------------------------------------------------------------------------
console.log('\n### 7. Regra da testemunha')
// -------------------------------------------------------------------------
ok('PJ sem segundo sócio exige testemunha', F.isWitnessRequired(r.corbanData) === true)

const comSocio2 = F.setValueAtPath(
  F.setValueAtPath(r.corbanData, 'socios.1.name', 'Maria Souza'),
  'master.has_secondary_socio', true)
ok('PJ com segundo sócio não exige testemunha', F.isWitnessRequired(comSocio2) === false)

const pf = F.routeFormAnswersToCorbanData({ person_type: 'PF', name: 'Fulano' }, {})
ok('PF nunca exige testemunha', F.isWitnessRequired(pf.corbanData) === false)

// -------------------------------------------------------------------------
console.log('\n### 8. Tags para os modelos de documento/e-mail/whatsapp')
// -------------------------------------------------------------------------
const tokens = F.getTemplateTokens()
ok('catálogo de tags cobre todos os campos', tokens.length === F.AGENTE_CORBAN_FIELDS.length)
ok('tag no formato {{key}}', tokens.some((t) => t.token === '{{cpf_cnpj}}'))
const signers = F.getSignerFields()
ok('há campos marcados como assinante', signers.length > 0)
console.log(`    ${tokens.length} tags disponíveis, ${signers.length} campos de assinante`)

// -------------------------------------------------------------------------
console.log('\n### 9. Tradução field.key → system_key (schema do formulário)')
// -------------------------------------------------------------------------
const schema = [
  { key: 'f1', system_key: 'cpf_cnpj', label: 'CNPJ' },
  { key: 'f2', system_key: 'name', label: 'Razão Social' },
  { key: 'f3', system_key: 'none', label: 'Pergunta livre' },
  { key: 'f4', label: 'Sem system_key' },
  { key: 'f5', system_key: 'email_comissao', label: 'E-mail (1ª ocorrência, vazia)' },
  { key: 'f6', system_key: 'email_comissao', label: 'E-mail (2ª ocorrência, preenchida)' },
  { id: 'f7', system_key: 'phone_whatsapp', label: 'Campo que usa id em vez de key' },
]
const respostasPorCampo = {
  f1: '12345678000190', f2: 'ACME LTDA', f3: 'texto livre', f4: 'outro texto',
  f5: '   ', f6: 'contato@acme.com.br', f7: '11988887777',
}
const mapped = F.mapFormAnswersToSystemKeys(schema, respostasPorCampo)

check('traduz chave do campo para system_key', mapped.cpf_cnpj, '12345678000190')
check("ignora system_key 'none'", mapped.none, undefined)
ok('ignora campo sem system_key', !Object.values(mapped).includes('outro texto'))
check('primeiro preenchido vence (pula o vazio)', mapped.email_comissao, 'contato@acme.com.br')
check('aceita campo que usa id em vez de key', mapped.phone_whatsapp, '11988887777')
check('schema ausente devolve objeto vazio', F.mapFormAnswersToSystemKeys(null, respostasPorCampo), {})
check('respostas ausentes devolvem objeto vazio', F.mapFormAnswersToSystemKeys(schema, null), {})

const cadeia = F.routeFormAnswersToCorbanData(mapped, {})
check('cadeia completa grava no caminho canônico',
  F.getValueAtPath(cadeia.corbanData, 'contacts.email_comissao'), 'contato@acme.com.br')
check('cadeia completa normaliza telefone',
  F.getValueAtPath(cadeia.corbanData, 'contacts.phone_whatsapp'), '11988887777')

// -------------------------------------------------------------------------
console.log('\n### 10. Seletor do Construtor de Formulário')
// -------------------------------------------------------------------------
const grupos = F.getSystemKeyOptionGroups()
ok('seletor tem grupos', grupos.length > 0)
ok('não oferece campos do ARW no formulário público',
  !grupos.some((g) => g.group === 'access'))
ok('oferece campos de testemunha', grupos.some((g) => g.group === 'witness'))
const comAcesso = F.getSystemKeyOptionGroups(true)
ok('inclui ARW quando pedido explicitamente', comAcesso.some((g) => g.group === 'access'))
console.log(`    ${grupos.length} grupos, ${grupos.reduce((n, g) => n + g.options.length, 0)} campos ofertados`)

// -------------------------------------------------------------------------
console.log('\n' + '='.repeat(56))
if (fail > 0) {
  console.log(failures.join('\n'))
  console.log('='.repeat(56))
}
console.log(`${fail === 0 ? '✅' : '❌'}  ${pass} passaram, ${fail} falharam`)
process.exit(fail === 0 ? 0 : 1)
