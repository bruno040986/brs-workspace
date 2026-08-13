/**
 * Módulo de integração com a Assinafy (assinatura eletrônica).
 *
 * Uso típico numa server action:
 *
 *   import { AssinafyClient } from '@/lib/assinafy'
 *
 *   const client = await AssinafyClient.fromActiveConfig()
 *   const doc = await client.uploadDocument(pdfBytes, 'contrato.pdf')
 *   const signer = await client.createSigner({ full_name, email })
 *   const assignment = await client.createAssignment(doc.id, {
 *     method: 'virtual',
 *     signers: [{ id: signer.id, verification_method: 'Email', notification_methods: ['Email'], step: 1 }],
 *   })
 *   // assignment.signing_urls → link individual por parte
 */

export * from './types'
export * from './config'
export * from './client'
export * from './contract-mapping'
export * from './contract-fill'
export * from './generate-contract'
export * from './webhook'
export * from './documents'
