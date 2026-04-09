-- Copagril Operação: tabelas mínimas para roles e relatórios.
-- Rode no SQL Editor do Supabase.

-- Necessário para UUIDs (em projetos novos geralmente já vem habilitado)
create extension if not exists pgcrypto;

-- 1) Perfil/Role do usuário (ligado ao auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  role text not null check (role in ('superadmin', 'estoquista')) default 'estoquista',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles: update own nome"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- 2) Eventos de auditoria (leitura e entrega)
create table if not exists public.nfe_eventos (
  id uuid primary key default gen_random_uuid(),
  chave_acesso varchar(44) not null,
  user_id uuid not null references auth.users(id),
  tipo text not null check (tipo in ('LEITURA','ENTREGA')),
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists nfe_eventos_chave_created_idx
  on public.nfe_eventos (chave_acesso, created_at desc);

create index if not exists nfe_eventos_user_created_idx
  on public.nfe_eventos (user_id, created_at desc);

alter table public.nfe_eventos enable row level security;

-- superadmin vê tudo; usuário comum vê apenas seus eventos
create policy "nfe_eventos: read own or superadmin"
on public.nfe_eventos for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

create policy "nfe_eventos: insert self"
on public.nfe_eventos for insert
with check (auth.uid() = user_id);

-- 3) Notas e itens da nota (cache local da NFe)
create table if not exists public.notas (
  id uuid primary key default gen_random_uuid(),
  chave_acesso varchar(44) not null unique,
  data_emissao timestamptz,
  payload jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists notas_chave_acesso_idx
  on public.notas (chave_acesso);

-- Fechamento de entrega (bloqueia +/- após conferência final)
alter table public.notas add column if not exists entrega_fechada boolean not null default false;
alter table public.notas add column if not exists entrega_fechada_em timestamptz;
alter table public.notas add column if not exists entrega_fechada_por uuid references auth.users(id) on delete set null;

create table if not exists public.itens_nota (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas(id) on delete cascade,
  descricao text not null,
  unidade varchar(10),
  quantidade_total numeric not null,
  quantidade_entregue numeric not null default 0,
  saldo_restante numeric not null default 0,
  status varchar(10) not null default 'PENDENTE' check (status in ('PENDENTE','PARCIAL','ENTREGUE')),
  ultima_retirada_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists itens_nota_nota_id_idx
  on public.itens_nota (nota_id);

alter table public.itens_nota
  add column if not exists parcial_confirmada boolean not null default false;

-- RLS (opcional, mas recomendado): leitura liberada para usuários autenticados;
-- escrita (insert/update) apenas superadmin (para evitar edição manual indevida).
alter table public.notas enable row level security;
alter table public.itens_nota enable row level security;

create policy "notas: read authenticated"
on public.notas for select
to authenticated
using (true);

create policy "itens_nota: read authenticated"
on public.itens_nota for select
to authenticated
using (true);

create policy "notas: write only superadmin"
on public.notas for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

create policy "itens_nota: write only superadmin"
on public.itens_nota for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

create policy "itens_nota: update only superadmin"
on public.itens_nota for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

-- 4) Jobs assíncronos (para não travar tablet aguardando Meu Danfe)
create table if not exists public.nfe_jobs (
  id uuid primary key default gen_random_uuid(),
  chave_acesso varchar(44) not null unique,
  status varchar(12) not null default 'PENDENTE'
    check (status in ('PENDENTE','PROCESSANDO','OK','ERRO')),
  nota_id uuid references public.notas(id) on delete set null,
  erro text,
  tentativas int not null default 0,
  solicitado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz
);

create index if not exists nfe_jobs_status_criado_idx
  on public.nfe_jobs (status, criado_em);

alter table public.nfe_jobs enable row level security;

create policy "nfe_jobs: read authenticated"
on public.nfe_jobs for select
to authenticated
using (true);

create policy "nfe_jobs: insert authenticated"
on public.nfe_jobs for insert
to authenticated
with check (true);

