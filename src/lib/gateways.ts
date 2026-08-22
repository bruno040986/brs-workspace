/**
 * Gateways de pagamento Pix (config no Workspace, consumo no Portal Parceiro).
 * Campos de credencial por gateway — novos gateways = nova linha na tabela
 * gateway_pagamentos + entrada aqui.
 */

export type GatewayCredencialCampo = {
  key: string
  label: string
  dica?: string
}

export const GATEWAY_CAMPOS: Record<string, GatewayCredencialCampo[]> = {
  mercadopago: [
    { key: 'access_token', label: 'Access Token' },
    { key: 'webhook_secret', label: 'Assinatura secreta do webhook', dica: 'Usada para validar o header x-signature dos webhooks.' },
  ],
  abacatepay: [
    { key: 'api_key', label: 'API Key' },
    { key: 'webhook_secret', label: 'Segredo do webhook', dica: 'Definido ao cadastrar o webhook no dashboard do Abacate (vai na URL como ?webhookSecret=). O portal recusa webhooks sem ele.' },
  ],
}

export function gatewayUsaTaxaPercentual(id: string) {
  return id === 'mercadopago'
}
