-- Confirmação explícita de entrega parcial (trava o botão − só após o operador tocar em "Entrega parcial").
alter table public.itens_nota
  add column if not exists parcial_confirmada boolean not null default false;
