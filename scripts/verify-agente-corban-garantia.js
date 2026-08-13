/**
 * Verificação executável da regra de negócio da Garantia (src/lib/agente-corban-garantia.ts).
 *
 * O projeto não tem suíte de testes; este script roda a lógica de verdade.
 *
 * COMO RODAR (a partir da raiz do projeto):
 *   1. Compilar para JS:
 *      npx tsc src/lib/agente-corban-garantia.ts --outDir /tmp/g-build \
 *        --module commonjs --target ES2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   2. Rodar:
 *      BUILD_DIR=/tmp/g-build node scripts/verify-agente-corban-garantia.js
 *
 * Regra: garantia cobre o bimestre (soma de 2 meses ≤ garantido); faixas dobram sem teto
 * (500k→1M→2M→4M…); se o bimestre mais recente ultrapassa a faixa, sinaliza revisão.
 */

const path = require('path')
const BUILD = process.env.BUILD_DIR || '/tmp/g-build'

let G
try {
  G = require(path.join(BUILD, 'agente-corban-garantia.js'))
} catch (err) {
  console.error(`\n✗ Não consegui carregar o build em ${BUILD} — rode o passo 1 do cabeçalho.\n  ${err.message}\n`)
  process.exit(1)
}

let pass = 0, fail = 0
const failures = []
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(`  ✗ ${n}${d ? '\n     ' + d : ''}`) } }
const eq = (n, a, e) => ok(n, a === e, `esperado ${e} obtido ${a}`)

const prod6 = [
  { mes: '2026-02', valor: 200000 }, { mes: '2026-03', valor: 210000 },
  { mes: '2026-04', valor: 230000 }, { mes: '2026-05', valor: 250000 },
  { mes: '2026-06', valor: 280000 }, { mes: '2026-07', valor: 240000 },
]

console.log('\n### bimestre mais recente')
eq('jun+jul = 520k', G.bimestreMaisRecente(prod6), 520000)
eq('ordena fora de ordem', G.bimestreMaisRecente([{ mes: '2026-07', valor: 240000 }, { mes: '2026-06', valor: 280000 }, { mes: '2026-01', valor: 100000 }]), 520000)
eq('um mês só', G.bimestreMaisRecente([{ mes: '2026-07', valor: 333000 }]), 333000)
eq('vazio = 0', G.bimestreMaisRecente([]), 0)

console.log('\n### médias')
eq('média mensal dos 6', Math.round(G.mediaMensal(prod6)), 235000)

console.log('\n### faixas (500k × 2^n, sem teto)')
eq('300k → 500k', G.faixaQueComporta(300000), 500000)
eq('500k → 500k', G.faixaQueComporta(500000), 500000)
eq('520k → 1M', G.faixaQueComporta(520000), 1000000)
eq('1.2M → 2M', G.faixaQueComporta(1200000), 2000000)
eq('2.1M → 4M', G.faixaQueComporta(2100000), 4000000)
eq('próxima de 500k = 1M', G.proximaFaixa(500000), 1000000)
eq('próxima de 2M = 4M', G.proximaFaixa(2000000), 4000000)

console.log('\n### avaliarGarantia (exemplo do Bruno)')
const a = G.avaliarGarantia(500000, prod6)
eq('bimestre 520k', a.bimestreRecente, 520000)
ok('precisa revisar (520k > 500k)', a.precisaRevisar === true)
eq('faixa sugerida = 1M', a.faixaSugerida, 1000000)

console.log('\n### dentro da garantia → não revisa')
const b = G.avaliarGarantia(1000000, prod6)
ok('520k < 1M → não revisa', b.precisaRevisar === false)
eq('mantém 1M', b.faixaSugerida, 1000000)

console.log('\n### garantido ausente assume faixa base')
const c = G.avaliarGarantia(0, [{ mes: '2026-07', valor: 100000 }])
eq('assume 500k', c.valorGarantido, 500000)

console.log('\n' + '='.repeat(48))
if (fail) console.log(failures.join('\n') + '\n' + '='.repeat(48))
console.log(`${fail === 0 ? '✅' : '❌'}  ${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
