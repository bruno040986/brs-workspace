/** Lacunas de fonte declaradas (mostradas no painel). Nada aqui é afirmação de que o evento não ocorreu. */
export const LACUNAS_FONTE: { fonte: string; lacuna: string }[] = [
  { fonte: 'Auth (GoTrue)', lacuna: 'Chamadas diretas ao Auth (signin/signup/recover/token) não passam pela aplicação. auth.audit_log_entries/log drain não coletados: sem tentativa direta, sem signup tentado e bloqueado.' },
  { fonte: 'Config do Auth', lacuna: 'Signup, provedores, expiração do JWT e MFA não são legíveis pelo banco. O monitor só detecta o efeito (conta em auth.users sem cadastro interno).' },
  { fonte: 'Storage', lacuna: 'Sem log de acesso a objetos. O monitor vê bucket público e policies de storage.objects, não leituras.' },
  { fonte: 'PostgREST/Data API', lacuna: 'Sem log de requisições. Data API está desativada; se religada, só pg_policies/grants protegem e nada registra o uso.' },
  { fonte: 'Aplicação', lacuna: 'Só eventos dos ganchos instalados (login M04, usuários). Rotas que não chamam registrarEventoSeguranca não geram evento.' },
  { fonte: 'Portal/CRM/Engine', lacuna: 'Outros sistemas não enviam eventos a este núcleo.' },
]
