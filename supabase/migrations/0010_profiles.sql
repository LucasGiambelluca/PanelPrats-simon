-- 0010: roles por usuario (admin / empleada). Single-org. Idempotente.
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'empleada' CHECK (role IN ('admin','empleada')),
  name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- El usuario existente queda como admin.
INSERT INTO profiles (id, role, name)
  SELECT id, 'admin', 'Administrador' FROM auth.users WHERE email = 'rsgroupenter@gmail.com'
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
