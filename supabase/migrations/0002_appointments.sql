-- Tabla appointments: citas agendadas desde el bot (nodo appointmentNode).
CREATE TABLE IF NOT EXISTS appointments (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
    phone       text,          -- teléfono de contacto (puede venir del flujo o del remitente)
    nombre      text,
    telefono    text,
    resumen     text,
    status      text DEFAULT 'pendiente',
    created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_account ON appointments(account_id);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_owner ON appointments
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));
