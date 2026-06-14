import { NodeExecutor, ExecutionContext } from './types';
import { supabase } from '../../config/database';

/**
 * BusinessHoursExecutor — Evalúa si el momento actual está dentro del horario
 * de atención configurado.
 *
 * ADAPTACIÓN (Plan 2, Task 5): lee la config de `whatsapp_config.business_hours`.
 * En el panel genérico esa tabla/columna puede no existir todavía (la fuente por
 * `account_id` se resuelve en Plan 3). El executor es FAIL-OPEN: si la lectura de
 * config falla (error de DB), si la config no existe, o si `isActive` es false,
 * devuelve `conditionResult: true` (siempre abierto). El comportamiento original
 * de fail-open ya estaba presente y se conserva verbatim.
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
    const [h, m] = timeStr.split(':').map(Number);
    return { hours: h, minutes: m };
}

function toMinutes(hours: number, minutes: number): number {
    return hours * 60 + minutes;
}

export class BusinessHoursExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<any> {
        console.log('[BusinessHoursExecutor] ⏰ Checking business hours...');
        try {
            // 1. Load global business hours from whatsapp_config
            const { data: config, error: dbError } = await supabase
                .from('whatsapp_config')
                .select('business_hours')
                .single();

            if (dbError) {
                console.error('[BusinessHoursExecutor] ❌ DB Error:', dbError.message);
                console.error('[BusinessHoursExecutor] ⚠️  Run this SQL in Supabase SQL Editor:');
                console.error(`ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '{"isActive":false,"days":[1,2,3,4,5],"startTime":"09:00","endTime":"18:00","timezone":"America/Argentina/Buenos_Aires"}'::jsonb;`);
                // Fail open: if we can't read config, assume open
                return { messages: [], wait_for_input: false, conditionResult: true };
            }

            const businessHours = config?.business_hours;
            console.log('[BusinessHoursExecutor] Config:', JSON.stringify(businessHours));

            // If isActive is false/missing, treat as always open (no restriction)
            if (!businessHours || !businessHours.isActive) {
                console.log('[BusinessHoursExecutor] isActive=false → conditionResult: true (always open)');
                return { messages: [], wait_for_input: false, conditionResult: true };
            }

            const { days, shifts, startTime, endTime, timezone, cutoffMinutes = 0 } = businessHours;

            // 2. Get current local time using the configured timezone
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone || 'America/Argentina/Buenos_Aires',
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });

            const parts = formatter.formatToParts(now);
            const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? '';
            const hourStr   = parts.find(p => p.type === 'hour')?.value ?? '0';
            const minuteStr = parts.find(p => p.type === 'minute')?.value ?? '0';

            const currentDay = weekdayMap[weekdayStr] ?? now.getDay();
            const currentMinutes = toMinutes(parseInt(hourStr, 10), parseInt(minuteStr, 10));

            // 2.1 Check for Special Closures (Holidays/Vacations)
            const specialClosures = businessHours.specialClosures || [];
            const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone || 'America/Argentina/Buenos_Aires',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            const dParts = datePartsFormatter.formatToParts(now);
            const y = dParts.find(p => p.type === 'year')?.value;
            const m = dParts.find(p => p.type === 'month')?.value;
            const d = dParts.find(p => p.type === 'day')?.value;
            const currentDateStr = `${y}-${m}-${d}`;

            if (specialClosures.includes(currentDateStr)) {
                console.log(`[BusinessHoursExecutor] ❌ CLOSED: Special closure detected for date ${currentDateStr}`);
                return { messages: [], wait_for_input: false, conditionResult: false };
            }

            const isDayOpen = (days as number[]).includes(currentDay);
            if (!isDayOpen) {
                console.log(`[BusinessHoursExecutor] ❌ CLOSED: Day ${weekdayStr}(${currentDay}) not in open days [${days}]`);
                return { messages: [], wait_for_input: false, conditionResult: false };
            }

            // 3. Check against shifts (or fallback to legacy startTime/endTime)
            const activeShifts = shifts && Array.isArray(shifts) && shifts.length > 0
                ? shifts
                : [{ startTime: startTime || '09:00', endTime: endTime || '18:00' }];

            let isTimeOpen = false;
            let cutoffReason = false;

            for (const shift of activeShifts) {
                const s = parseTime(shift.startTime);
                const e = parseTime(shift.endTime);
                const startMins = toMinutes(s.hours, s.minutes);
                const endMins   = toMinutes(e.hours, e.minutes);

                // Effective end considering cutoff
                const effectiveEndMins = endMins - cutoffMinutes;

                if (currentMinutes >= startMins && currentMinutes < endMins) {
                    // We are within the shift window
                    if (currentMinutes < effectiveEndMins) {
                        isTimeOpen = true;
                        break;
                    } else {
                        // We are in the cutoff zone
                        cutoffReason = true;
                    }
                }
            }

            const isOpen = isTimeOpen;

            console.log(`[BusinessHoursExecutor] 📅 Day: ${weekdayStr}(${currentDay}) | Time: ${hourStr}:${minuteStr}(${currentMinutes}m)`);
            console.log(`[BusinessHoursExecutor] 🕒 Shifts: ${JSON.stringify(activeShifts)} | Cutoff: ${cutoffMinutes}m`);
            console.log(`[BusinessHoursExecutor] 🏪 Status: ${isOpen ? '✅ OPEN' : cutoffReason ? '❌ CUTOFF ZONE' : '❌ CLOSED'}`);

            return {
                messages: [],
                wait_for_input: false,
                conditionResult: isOpen,
            };
        } catch (err: any) {
            console.error('[BusinessHoursExecutor] ❌ Unexpected error:', err?.message || err);
            return { messages: [], wait_for_input: false, conditionResult: true };
        }
    }
}
