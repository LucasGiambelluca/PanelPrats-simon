-- 0006: minutos de anticipación del recordatorio de citas, configurable por cuenta.
-- Default 20'. El ReminderScheduler lo lee por cuenta.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS reminder_minutes int DEFAULT 20;
