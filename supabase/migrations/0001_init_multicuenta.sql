-- Migración inicial: panel WhatsApp multi-cuenta
-- Schema genérico (sin comercio), account_id incorporado de raíz.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. accounts: cada número WhatsApp conectado
CREATE TABLE IF NOT EXISTS accounts (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name         text NOT NULL,
    phone_number text,
    status       text NOT NULL DEFAULT 'disconnected'
                   CHECK (status IN ('disconnected','connecting','qr','connected')),
    session_path text,
    qr_code      text,
    created_at   timestamptz DEFAULT now(),
    updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

-- 2. flows: definición visual de un flujo
CREATE TABLE IF NOT EXISTS flows (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name         varchar(255) NOT NULL,
    description  text,
    trigger_word varchar(100),
    trigger_type varchar(20) DEFAULT 'exact',
    is_active    boolean DEFAULT false,
    is_default   boolean DEFAULT false,
    nodes        jsonb DEFAULT '[]'::jsonb,
    edges        jsonb DEFAULT '[]'::jsonb,
    viewport     jsonb DEFAULT '{}'::jsonb,
    created_at   timestamptz DEFAULT now(),
    updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flows_acct_trigger
    ON flows(account_id, trigger_word) WHERE is_active = true;

-- 3. flow_executions: estado de sesión de un usuario en un flujo
CREATE TABLE IF NOT EXISTS flow_executions (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    flow_id          uuid REFERENCES flows(id) ON DELETE SET NULL,
    phone            varchar(50) NOT NULL,
    session_id       text NOT NULL,
    current_node_id  varchar(100),
    status           varchar(20) DEFAULT 'active',
    context          jsonb DEFAULT '{}'::jsonb,
    global_variables jsonb DEFAULT '{}'::jsonb,
    version          integer DEFAULT 0,
    started_at       timestamptz DEFAULT now(),
    last_activity    timestamptz DEFAULT now(),
    expires_at       timestamptz,
    completed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_flowexec_acct_phone_status
    ON flow_executions(account_id, phone, status);
CREATE INDEX IF NOT EXISTS idx_flowexec_session ON flow_executions(session_id);

-- 4. flow_executions_history: sesiones archivadas
CREATE TABLE IF NOT EXISTS flow_executions_history (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      uuid,
    original_id     uuid,
    flow_id         uuid,
    phone           text,
    session_id      text,
    current_node_id text,
    status          text,
    context         jsonb,
    started_at      timestamptz,
    last_activity   timestamptz,
    completed_at    timestamptz,
    archived_at     timestamptz DEFAULT now(),
    archived_reason text,
    version         integer
);
CREATE INDEX IF NOT EXISTS idx_flowexec_hist_session ON flow_executions_history(session_id);

-- 5. whatsapp_conversations: estado de conversación + handover
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone           text NOT NULL,
    contact_name    text,
    last_message    text,
    last_message_at timestamptz,
    unread_count    integer DEFAULT 0,
    status          varchar(20) DEFAULT 'BOT' CHECK (status IN ('BOT','HANDOVER')),
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    UNIQUE (account_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_waconv_acct_phone ON whatsapp_conversations(account_id, phone);

-- 6. whatsapp_messages: log de mensajes
-- account_id + phone están DENORMALIZADOS (además de colgar de conversation_id) para
-- consultas directas: historial por cuenta (getHistory) y filtrado de Realtime en el inbox.
CREATE TYPE wa_message_direction AS ENUM ('INBOUND','OUTBOUND');
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    account_id      uuid REFERENCES accounts(id) ON DELETE CASCADE,
    phone           text,
    direction       wa_message_direction NOT NULL,
    content         text,
    media_url       text,
    message_type    text DEFAULT 'text',
    wa_message_id   text,
    is_read         boolean DEFAULT false,
    "timestamp"     timestamptz DEFAULT now(),
    created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wamsg_conv ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wamsg_ts ON whatsapp_messages("timestamp");
CREATE INDEX IF NOT EXISTS idx_wamsg_acct_phone ON whatsapp_messages(account_id, phone);

-- 7. flow_logs: auditoría de ejecución de nodos
CREATE TABLE IF NOT EXISTS flow_logs (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      uuid,
    created_at      timestamptz DEFAULT now(),
    session_id      text NOT NULL,
    phone           text,
    flow_id         text,
    node_id         text,
    node_type       text,
    input_text      text,
    output_messages jsonb DEFAULT '[]',
    execution_time_ms integer,
    metadata        jsonb DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_flowlogs_session ON flow_logs(session_id);

-- 8. audit_logs: trazas crudas del SessionAuditor (eventos/errores de sesión)
CREATE TABLE IF NOT EXISTS audit_logs (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "timestamp" timestamptz DEFAULT now(),
    account_id  uuid,
    session_id  text,
    event_type  text,
    message_id  text,
    user_phone  text,
    details     jsonb,
    stack_trace text
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_session ON audit_logs(session_id);

-- 9. reports: registros genéricos creados por el nodo reportNode (reclamos/avisos)
CREATE TABLE IF NOT EXISTS reports (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
    phone       text,
    type        text DEFAULT 'reclamo',
    description text,
    priority    text DEFAULT 'medium',
    status      text DEFAULT 'open',
    metadata    jsonb DEFAULT '{}',
    created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_account ON reports(account_id);

-- RLS: cada usuario ve sus propias cuentas y datos derivados.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- accounts: dueño = user_id
CREATE POLICY accounts_owner ON accounts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- flows / flow_executions / conversations: dueño vía join a accounts
CREATE POLICY flows_owner ON flows
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

CREATE POLICY flowexec_owner ON flow_executions
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

CREATE POLICY waconv_owner ON whatsapp_conversations
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- messages: dueño vía conversación
CREATE POLICY wamsg_owner ON whatsapp_messages
    FOR ALL USING (conversation_id IN (
        SELECT c.id FROM whatsapp_conversations c
        JOIN accounts a ON a.id = c.account_id
        WHERE a.user_id = auth.uid()
    ));
