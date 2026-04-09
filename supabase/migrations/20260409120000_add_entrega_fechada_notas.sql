-- Rode no SQL Editor do Supabase (ou via CLI) se ainda não aplicou o trecho equivalente do schema.sql.
alter table public.notas add column if not exists entrega_fechada boolean not null default false;
alter table public.notas add column if not exists entrega_fechada_em timestamptz;
alter table public.notas add column if not exists entrega_fechada_por uuid references auth.users(id) on delete set null;
