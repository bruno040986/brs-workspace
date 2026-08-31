-- Exclusão pontual de um elogio do Mural de Elogios, a pedido do Bruno
-- (30/08/2026): elogio de Ketellen Freires Batista para Bruno Rodrigues da
-- Silva, 29/05/2026 23:20 ("Parabéns sistema 10/10, top demais!!!").
-- praise_reactions/praise_notifications ligados saem junto via ON DELETE CASCADE.
delete from public.praise_messages
where id = '62bf9fa7-a23e-459f-b687-4835c8c5cf99';
