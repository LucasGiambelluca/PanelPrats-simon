import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import {
  appointmentsApi, professionalsApi, agendaApi, Appointment,
  MOTIVO_LABELS, CANAL_LABELS, RESULTADO_LABELS,
  type AppointmentMotivo, type AppointmentCanal, type AppointmentResultado,
} from '../lib/api';
import type { ProfessionalLite } from '../types';
import CallReminderModal from '../components/CallReminderModal';
import CallActions from '../components/CallActions';
import { toast } from 'sonner';
import {
  Calendar as CalendarIcon, CheckCircle, XCircle, Clock, Trash2, Search, RefreshCw,
  Phone, UserCheck, Shield, Plus, ChevronLeft, ChevronRight, Info, User,
  FileText, Menu, Check, Filter, CalendarDays, Sun, Moon, Minus, MessageSquare
} from 'lucide-react';

function formatDistanceToNow(dateInput: Date | string): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'hace unos instantes';
  if (diffMins < 60) return `hace ${diffMins} min`;
  if (diffHours < 24) return `hace ${diffHours} h`;
  if (diffDays === 1) return 'hace 1 día';
  return `hace ${diffDays} días`;
}

// Formatea un monto en pesos argentinos: 29000 => "$29.000".
const fmtMonto = (n: number) => '$' + n.toLocaleString('es-AR');

const months = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const weekDaysNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7:00 to 22:00
// Pseudo-agenda para citas sin profesional asignado.
const UNASSIGNED = '__unassigned__';

// Niveles discretos de zoom (alto de la fila de una hora, en px).
const ZOOM_LEVELS = [40, 56, 68, 96, 128, 160];

// Paleta fija de "agendas" (una por profesional), estilo Google Calendar.
// Cada entrada trae clases Tailwind para tema claro y oscuro: fondo + borde
// izquierdo + texto + hover. El último elemento (gris) es para "Sin asignar".
type ProfPalette = { light: string; dark: string; swatch: string };
const PROF_PALETTE: ProfPalette[] = [
  { light: 'bg-[#e8f0fe] border-l-[4px] border-[#1a73e8] text-[#1a4fa0] hover:bg-[#1a73e8]/10', dark: 'bg-blue-500/10 border-l-[4px] border-blue-500 text-blue-300 hover:bg-blue-500/20', swatch: 'bg-[#1a73e8]' },
  { light: 'bg-[#e6f4ea] border-l-[4px] border-[#137333] text-[#0f5927] hover:bg-[#137333]/10', dark: 'bg-emerald-500/10 border-l-[4px] border-emerald-500 text-emerald-300 hover:bg-emerald-500/20', swatch: 'bg-[#137333]' },
  { light: 'bg-[#fce8e6] border-l-[4px] border-[#c5221f] text-[#a11b19] hover:bg-[#c5221f]/10', dark: 'bg-red-500/10 border-l-[4px] border-red-500 text-red-300 hover:bg-red-500/20', swatch: 'bg-[#c5221f]' },
  { light: 'bg-[#fff3e0] border-l-[4px] border-[#e8710a] text-[#b45309] hover:bg-[#e8710a]/10', dark: 'bg-orange-500/10 border-l-[4px] border-orange-500 text-orange-300 hover:bg-orange-500/20', swatch: 'bg-[#e8710a]' },
  { light: 'bg-[#f3e8fd] border-l-[4px] border-[#8430ce] text-[#6b21a8] hover:bg-[#8430ce]/10', dark: 'bg-purple-500/10 border-l-[4px] border-purple-500 text-purple-300 hover:bg-purple-500/20', swatch: 'bg-[#8430ce]' },
  { light: 'bg-[#e0f7f6] border-l-[4px] border-[#009688] text-[#00695c] hover:bg-[#009688]/10', dark: 'bg-teal-500/10 border-l-[4px] border-teal-500 text-teal-300 hover:bg-teal-500/20', swatch: 'bg-[#009688]' },
  { light: 'bg-[#fde7f3] border-l-[4px] border-[#d81b60] text-[#ad1457] hover:bg-[#d81b60]/10', dark: 'bg-pink-500/10 border-l-[4px] border-pink-500 text-pink-300 hover:bg-pink-500/20', swatch: 'bg-[#d81b60]' },
  { light: 'bg-[#fef7e0] border-l-[4px] border-[#b06000] text-[#8e4d00] hover:bg-[#b06000]/10', dark: 'bg-amber-500/10 border-l-[4px] border-amber-500 text-amber-300 hover:bg-amber-500/20', swatch: 'bg-[#b06000]' },
  { light: 'bg-[#e8eaf6] border-l-[4px] border-[#3f51b5] text-[#283593] hover:bg-[#3f51b5]/10', dark: 'bg-indigo-500/10 border-l-[4px] border-indigo-500 text-indigo-300 hover:bg-indigo-500/20', swatch: 'bg-[#3f51b5]' },
  { light: 'bg-[#f1f8e9] border-l-[4px] border-[#689f38] text-[#33691e] hover:bg-[#689f38]/10', dark: 'bg-lime-500/10 border-l-[4px] border-lime-500 text-lime-300 hover:bg-lime-500/20', swatch: 'bg-[#689f38]' },
  { light: 'bg-[#e0f2f1] border-l-[4px] border-[#00838f] text-[#006064] hover:bg-[#00838f]/10', dark: 'bg-cyan-500/10 border-l-[4px] border-cyan-500 text-cyan-300 hover:bg-cyan-500/20', swatch: 'bg-[#00838f]' },
  { light: 'bg-[#fbe9e7] border-l-[4px] border-[#d84315] text-[#bf360c] hover:bg-[#d84315]/10', dark: 'bg-rose-500/10 border-l-[4px] border-rose-500 text-rose-300 hover:bg-rose-500/20', swatch: 'bg-[#d84315]' },
  { light: 'bg-[#ede7f6] border-l-[4px] border-[#5e35b1] text-[#4527a0] hover:bg-[#5e35b1]/10', dark: 'bg-violet-500/10 border-l-[4px] border-violet-500 text-violet-300 hover:bg-violet-500/20', swatch: 'bg-[#5e35b1]' },
  { light: 'bg-[#e3f2fd] border-l-[4px] border-[#0277bd] text-[#01579b] hover:bg-[#0277bd]/10', dark: 'bg-sky-500/10 border-l-[4px] border-sky-500 text-sky-300 hover:bg-sky-500/20', swatch: 'bg-[#0277bd]' },
];
// Color gris para "Sin asignar".
const UNASSIGNED_PALETTE: ProfPalette = {
  light: 'bg-slate-100 border-l-[4px] border-slate-400 text-slate-600 hover:bg-slate-200',
  dark: 'bg-white/5 border-l-[4px] border-slate-500 text-slate-300 hover:bg-white/10',
  swatch: 'bg-slate-400',
};

// Índice de color estable de un profesional, según su posición en la lista
// ordenada por id. Devuelve la entrada gris si no hay profesional (sin asignar).
function profPalette(orderedProfIds: string[], profileId: string | null | undefined): ProfPalette {
  if (!profileId) return UNASSIGNED_PALETTE;
  const idx = orderedProfIds.indexOf(profileId);
  if (idx < 0) return UNASSIGNED_PALETTE;
  return PROF_PALETTE[idx % PROF_PALETTE.length];
}

// Predicado puro: ¿la cita es visible según las agendas seleccionadas?
function isProfVisible(selectedProfs: Set<string>, assignedProfileId: string | null | undefined): boolean {
  return selectedProfs.has(assignedProfileId ?? UNASSIGNED);
}

// Campos de la ficha de recepción (migración 0023) en el formData del modal.
// '' = sin cargar (se mapea a null al enviar). canal_auto trackea si el canal fue
// detectado por el sistema (prellenado desde la cuenta) o corregido a mano.
function emptyIntake() {
  return {
    motivo: '' as AppointmentMotivo | '',
    dni: '',
    faltante: '',
    canal_origen: '' as AppointmentCanal | '',
    canal_auto: true,
    carpeta: false,
    seguimiento: '',
    resultado: '' as AppointmentResultado | '',
  };
}

// canal de la cuenta → canal_origen por defecto (auto). FB/IG/WhatsApp mapean directo;
// el resto (tiktok/google/recomendada) no es autodetectable → queda vacío.
function autoCanalFromAccount(channel?: string): AppointmentCanal | '' {
  if (channel === 'facebook' || channel === 'instagram' || channel === 'whatsapp') return channel;
  return '';
}

// Inputs reutilizables para la ficha de recepción (mantienen el estilo del modal).
function fieldClass(theme: string) {
  return `w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all ${
    theme === 'light'
      ? 'bg-brand-surface border-brand-hairline text-brand-ink focus:ring-brand-primary/40 focus:border-brand-primary'
      : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
  }`;
}
function FieldLabel({ theme, label, hint }: { theme: string; label: string; hint?: string }) {
  return (
    <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
      theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
    }`}>
      <span>{label}</span>
      {hint && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[8px] normal-case font-semibold">{hint}</span>}
    </label>
  );
}
function FieldText({ theme, label, value, onChange, placeholder }: {
  theme: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel theme={theme} label={label} />
      <input type="text" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} className={fieldClass(theme)} />
    </div>
  );
}
function FieldSelect({ theme, label, value, onChange, options, hint }: {
  theme: string; label: string; value: string; onChange: (v: string) => void;
  options: [string, string][]; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel theme={theme} label={label} hint={hint} />
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass(theme)}>
        <option value="">—</option>
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}

export default function Agenda() {
  const { activeAccountId, accounts } = useAccounts();
  const navigate = useNavigate();

  // Abre el inbox directamente en la conversación de este contacto (deep-link).
  const goToChat = (app: Appointment) => {
    if (!app.phone && !app.telefono) { toast.error('La cita no tiene teléfono'); return; }
    const phone = app.phone || app.telefono;
    navigate(`/inbox?account=${encodeURIComponent(app.account_id)}&phone=${encodeURIComponent(phone)}`);
  };
  const { user, role, verTodasAgendas } = useAuth();
  // Ve la agenda de TODOS los profesionales: admin, o empleada con la capacidad
  // ver_todas_agendas. Solo lectura — reasignar sigue siendo admin-only.
  const puedeVerTodasAgendas = role === 'admin' || verTodasAgendas;
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [allLines, setAllLines] = useState(false); // true = agenda unificada de todas las líneas
  const [professionals, setProfessionals] = useState<ProfessionalLite[]>([]);
  // Agendas (profesionales) visibles. null = sin inicializar → muestra todo
  // (evita agenda en blanco si falla la carga). Set vacío = "Ninguna" (nada visible).
  // Admin: arranca con todas + sin-asignar. Empleada: bloqueada a su propia agenda.
  const [selectedProfs, setSelectedProfs] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Theme state: defaults to light to resemble Google Calendar exactly
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('agenda_theme') === 'dark' ? 'dark' : 'light')
  );
  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('agenda_theme', next); } catch { /* noop */ }
      return next;
    });
  };

  const toggleProf = (id: string) => {
    setSelectedProfs((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allProfKeys = () => [...professionals.map((p) => p.id), UNASSIGNED];
  const allSelected = professionals.length > 0 && selectedProfs !== null && allProfKeys().every((k) => selectedProfs.has(k));
  const toggleAllProfs = () => {
    setSelectedProfs(() => (allSelected ? new Set<string>() : new Set(allProfKeys())));
  };

  // Sidebar states
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filterPending, setFilterPending] = useState(true);
  const [filterConfirmed, setFilterConfirmed] = useState(true);
  const [filterCanceled, setFilterCanceled] = useState(true);
  const [filterAttended, setFilterAttended] = useState(true);
  const [filterNoShow, setFilterNoShow] = useState(true);
  const [filterClosed, setFilterClosed] = useState(true);

  // View settings
  const [view, setView] = useState<'month' | 'week' | 'day' | 'list'>('week');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [hourHeight, setHourHeight] = useState<number>(() => {
    const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('agenda_hour_height')) : NaN;
    return ZOOM_LEVELS.includes(saved) ? saved : 68;
  });
  const zoomBy = (dir: 1 | -1) => {
    setHourHeight((cur) => {
      const i = ZOOM_LEVELS.indexOf(cur);
      const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, (i < 0 ? ZOOM_LEVELS.indexOf(68) : i) + dir))];
      try { localStorage.setItem('agenda_hour_height', String(next)); } catch { /* noop */ }
      return next;
    });
  };
  const [miniDate, setMiniDate] = useState<Date>(new Date());

  // Real-time indicator
  const [now, setNow] = useState<Date>(new Date());

  // Modal settings
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [selectedApp, setSelectedApp] = useState<Appointment | null>(null);
  const [formData, setFormData] = useState({
    nombre: '',
    telefono: '',
    resumen: '',
    status: 'pendiente' as Appointment['status'],
    date: '',
    startHour: '09:00',
    endHour: '10:00',
    account_id: '',
    ...emptyIntake(),
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync real time line
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Scroll to active business hour (8 AM) on load
  useEffect(() => {
    if ((view === 'week' || view === 'day') && scrollContainerRef.current) {
      // 8 AM is index 1 from 7 AM → un alto de hora.
      scrollContainerRef.current.scrollTop = hourHeight;
    }
  }, [view]);

  // Load appointments. allLines (toggle) o cuenta activa = 'all' => agenda unificada.
  const loadAppointments = async (silent = false) => {
    const useAll = allLines || activeAccountId === 'all';
    if (!useAll && !activeAccountId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const data = await appointmentsApi.list(useAll ? 'all' : activeAccountId!);
      setAppointments(data);
    } catch (err: any) {
      toast.error('Error al cargar la agenda: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
    const interval = setInterval(() => {
      if (!document.hidden) loadAppointments(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeAccountId, allLines]);

  // Carga todas las agendas (admin o empleada con ver_todas_agendas) o bloquea a la propia.
  useEffect(() => {
    if (puedeVerTodasAgendas) {
      professionalsApi.list()
        .then((profs) => {
          setProfessionals(profs);
          // Arranca con todas las agendas + "sin asignar" visibles.
          setSelectedProfs(new Set([...profs.map((p) => p.id), UNASSIGNED]));
        })
        .catch(() => setSelectedProfs(null));
    } else if (user) {
      setSelectedProfs(new Set([user.id])); // empleada sin capacidad: solo su agenda
    }
  }, [puedeVerTodasAgendas, user]);

  // Synchronize mini calendar selected month when main calendar date changes
  useEffect(() => {
    setMiniDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  }, [currentDate]);

  // Ids de profesional ordenados de forma estable (por id) para asignar colores.
  const orderedProfIds = useMemo(
    () => professionals.map((p) => p.id).sort(),
    [professionals],
  );

  const statusLabel: Record<string, string> = {
    pendiente: 'pendiente', confirmada: 'confirmada', cancelada: 'cancelada',
    asistio: 'asistió', no_asistio: 'no asistió', cerrado: 'cerrado',
  };

  const handleUpdateStatus = async (id: string, newStatus: Appointment['status']) => {
    try {
      await appointmentsApi.update(id, { status: newStatus });
      toast.success(`Cita marcada como ${statusLabel[newStatus] || newStatus}`);
      loadAppointments(true);
    } catch (err: any) {
      toast.error('Error al actualizar cita: ' + err.message);
    }
  };

  const doDelete = async (id: string) => {
    try {
      await appointmentsApi.delete(id);
      toast.success('Cita eliminada de la agenda');
      setIsModalOpen(false);
      loadAppointments(true);
    } catch (err: any) {
      toast.error('Error al eliminar cita: ' + err.message);
    }
  };

  const handleAssign = async (appointmentId: string, profileId: string | null) => {
    try {
      await agendaApi.assign(appointmentId, profileId);
      toast.success(profileId ? 'Profesional asignado' : 'Cita sin asignar');
      loadAppointments(true);
      setSelectedApp((prev) => prev ? { ...prev, assigned_profile_id: profileId } : prev);
    } catch (err: any) {
      toast.error('No se pudo reasignar: ' + err.message);
    }
  };

  // Confirmación vía toast-action (sonner) en vez de window.confirm.
  const handleDelete = (id: string) => {
    toast('¿Eliminar esta cita de la agenda?', {
      duration: 10000,
      action: { label: 'Eliminar', onClick: () => doDelete(id) },
      cancel: { label: 'Cancelar', onClick: () => {} },
    });
  };

  // Date utilities
  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  };

  // Filtered list
  const filteredAppointments = appointments.filter((app) => {
    // Search filter
    const matchesSearch =
      app.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (app.resumen && app.resumen.toLowerCase().includes(searchTerm.toLowerCase()));

    // Sidebar status checkboxes filters
    let matchesStatusFilter = false;
    if (app.status === 'pendiente' && filterPending) matchesStatusFilter = true;
    if (app.status === 'confirmada' && filterConfirmed) matchesStatusFilter = true;
    if (app.status === 'cancelada' && filterCanceled) matchesStatusFilter = true;
    if (app.status === 'asistio' && filterAttended) matchesStatusFilter = true;
    if (app.status === 'no_asistio' && filterNoShow) matchesStatusFilter = true;
    if (app.status === 'cerrado' && filterClosed) matchesStatusFilter = true;

    // null = sin inicializar → mostrar todo. Cita con profesional desconocido
    // (no está en la lista cargada) cae en el bucket "Sin asignar". orderedProfIds
    // vacío (empleada) → no se reasigna, así ve sus propias citas por match exacto.
    const aid = app.assigned_profile_id;
    const profKey = aid && (orderedProfIds.length === 0 || orderedProfIds.includes(aid)) ? aid : UNASSIGNED;
    const matchesProf = selectedProfs === null || isProfVisible(selectedProfs, profKey);
    return matchesSearch && matchesStatusFilter && matchesProf;
  });

  // Calculate Month Days (Sunday first for Google Calendar)
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    
    // Sunday is 0, Monday is 1, etc.
    const startOffset = firstDay.getDay(); 
    
    const prevMonthDays = new Date(year, month, 0).getDate();
    const currentMonthDays = new Date(year, month + 1, 0).getDate();
    
    const cells: { date: Date; isCurrentMonth: boolean; isToday: boolean }[] = [];
    
    // Prev Month
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthDays - i);
      cells.push({ date: d, isCurrentMonth: false, isToday: isSameDay(d, new Date()) });
    }
    
    // Current Month
    for (let i = 1; i <= currentMonthDays; i++) {
      const d = new Date(year, month, i);
      cells.push({ date: d, isCurrentMonth: true, isToday: isSameDay(d, new Date()) });
    }
    
    // Next Month
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      cells.push({ date: d, isCurrentMonth: false, isToday: isSameDay(d, new Date()) });
    }
    
    return cells;
  };

  // Week Days (Sunday first for Google Calendar)
  const getWeekDays = (date: Date) => {
    const weekDays = [];
    const startOfWeek = new Date(date);
    const day = date.getDay();
    // Set to Sunday of this week
    startOfWeek.setDate(date.getDate() - day);
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      weekDays.push(d);
    }
    return weekDays;
  };

  // Nav Handlers
  const handlePrev = () => {
    const newD = new Date(currentDate);
    if (view === 'month') {
      newD.setMonth(currentDate.getMonth() - 1);
    } else if (view === 'week') {
      newD.setDate(currentDate.getDate() - 7);
    } else if (view === 'day') {
      newD.setDate(currentDate.getDate() - 1);
    }
    setCurrentDate(newD);
  };

  const handleNext = () => {
    const newD = new Date(currentDate);
    if (view === 'month') {
      newD.setMonth(currentDate.getMonth() + 1);
    } else if (view === 'week') {
      newD.setDate(currentDate.getDate() + 7);
    } else if (view === 'day') {
      newD.setDate(currentDate.getDate() + 1);
    }
    setCurrentDate(newD);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Mini Calendar Navigation
  const handleMiniPrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMiniDate(new Date(miniDate.getFullYear(), miniDate.getMonth() - 1, 1));
  };

  const handleMiniNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMiniDate(new Date(miniDate.getFullYear(), miniDate.getMonth() + 1, 1));
  };

  // Slot Selection
  const handleDayClick = (date: Date) => {
    const dateString = date.toISOString().split('T')[0];
    const nowHour = new Date().getHours();
    const startHourStr = `${String(Math.min(20, nowHour + 1)).padStart(2, '0')}:00`;
    const endHourStr = `${String(Math.min(21, nowHour + 2)).padStart(2, '0')}:00`;

    setSelectedApp(null);
    setFormData({
      nombre: '',
      telefono: '',
      resumen: '',
      status: 'pendiente',
      date: dateString,
      startHour: startHourStr,
      endHour: endHourStr,
      // En vista unificada activeAccountId === 'all' (no es una cuenta real). Para una
      // cita nueva prefijamos una cuenta real (la primera) — el usuario la confirma/cambia
      // en el select "Asignar a Cuenta". Sin esto se enviaba account_id='all' → la DB
      // rechazaba (uuid inválido) y no se podía agendar desde la agenda.
      account_id: (activeAccountId && activeAccountId !== 'all') ? activeAccountId : (accounts[0]?.id || ''),
      ...emptyIntake(),
      canal_origen: autoCanalFromAccount(accounts.find(a => a.id === ((activeAccountId && activeAccountId !== 'all') ? activeAccountId : accounts[0]?.id))?.channel),
    });
    setIsModalOpen(true);
  };

  const handleSlotClick = (date: Date, hour: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const dateString = date.toISOString().split('T')[0];
    const startHourStr = `${String(hour).padStart(2, '0')}:00`;
    const endHourStr = `${String(hour + 1).padStart(2, '0')}:00`;

    setSelectedApp(null);
    setFormData({
      nombre: '',
      telefono: '',
      resumen: '',
      status: 'pendiente',
      date: dateString,
      startHour: startHourStr,
      endHour: endHourStr,
      // En vista unificada activeAccountId === 'all' (no es una cuenta real). Para una
      // cita nueva prefijamos una cuenta real (la primera) — el usuario la confirma/cambia
      // en el select "Asignar a Cuenta". Sin esto se enviaba account_id='all' → la DB
      // rechazaba (uuid inválido) y no se podía agendar desde la agenda.
      account_id: (activeAccountId && activeAccountId !== 'all') ? activeAccountId : (accounts[0]?.id || ''),
      ...emptyIntake(),
      canal_origen: autoCanalFromAccount(accounts.find(a => a.id === ((activeAccountId && activeAccountId !== 'all') ? activeAccountId : accounts[0]?.id))?.channel),
    });
    setIsModalOpen(true);
  };

  const handleEditClick = (app: Appointment, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const appDate = new Date(app.start_time || app.created_at);
    const endDate = new Date(app.end_time || new Date(appDate.getTime() + 30 * 60000));
    
    const dateString = appDate.toISOString().split('T')[0];
    const startHourStr = `${String(appDate.getHours()).padStart(2, '0')}:${String(appDate.getMinutes()).padStart(2, '0')}`;
    const endHourStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

    setSelectedApp(app);
    setFormData({
      nombre: app.nombre,
      telefono: app.telefono || app.phone || '',
      resumen: app.resumen || '',
      status: app.status,
      date: dateString,
      startHour: startHourStr,
      endHour: endHourStr,
      account_id: app.account_id || activeAccountId || '',
      motivo: app.motivo ?? '',
      dni: app.dni ?? '',
      faltante: app.faltante ?? '',
      canal_origen: app.canal_origen ?? '',
      canal_auto: app.canal_auto ?? true,
      carpeta: app.carpeta ?? false,
      seguimiento: app.seguimiento ?? '',
      resultado: app.resultado ?? '',
    });
    setIsModalOpen(true);
  };

  const handleOpenNewAppointment = () => {
    handleDayClick(currentDate);
  };

  const runAudit = async () => {
    setAuditing(true);
    try {
      const r = await appointmentsApi.audit({ account_id: activeAccountId || undefined });
      toast.success(`Auditadas ${r.audited}: ${r.flagged} para revisar${r.truncated ? ' (se auditaron las primeras 50)' : ''}`);
      loadAppointments(true);
    } catch (err: any) {
      toast.error('Error al auditar: ' + err.message);
    } finally {
      setAuditing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nombre.trim()) {
      toast.error('El nombre es requerido');
      return;
    }
    if (!formData.telefono.trim()) {
      toast.error('El teléfono es requerido');
      return;
    }
    if (submitting) return; // evita doble-submit → citas duplicadas

    // Cuenta resuelta: nunca 'all' (vista unificada) ni vacío. La cita pertenece a una
    // línea concreta; sin esto se mandaba 'all' y la DB rechazaba (uuid inválido).
    const resolvedAccountId =
      (formData.account_id && formData.account_id !== 'all') ? formData.account_id
      : (activeAccountId && activeAccountId !== 'all') ? activeAccountId
      : (accounts[0]?.id || '');
    if (!resolvedAccountId) {
      toast.error('Elegí la cuenta/línea de la cita');
      return;
    }

    try {
      setSubmitting(true);
      const startTimeISO = new Date(`${formData.date}T${formData.startHour}`).toISOString();
      const endTimeISO = new Date(`${formData.date}T${formData.endHour}`).toISOString();
      if (new Date(endTimeISO).getTime() <= new Date(startTimeISO).getTime()) {
        toast.error('La hora de fin debe ser posterior a la de inicio');
        return;
      }

      // Ficha de recepción: '' → null (campo sin cargar). canal_auto se vuelve false
      // si la empleada eligió un canal distinto al detectado desde la cuenta.
      const autoCanal = autoCanalFromAccount(
        accounts.find(a => a.id === (formData.account_id || activeAccountId))?.channel,
      );
      const intake = {
        motivo: formData.motivo || null,
        dni: formData.dni.trim() || null,
        faltante: formData.faltante.trim() || null,
        canal_origen: formData.canal_origen || null,
        canal_auto: !!formData.canal_origen && formData.canal_origen === autoCanal,
        carpeta: formData.carpeta,
        seguimiento: formData.seguimiento.trim() || null,
        resultado: formData.resultado || null,
      };

      if (selectedApp) {
        // Edit mode
        // account_id NO se manda en el update: la cita no cambia de cuenta al
        // editar y updateAppointmentSchema es .strict() → una key extra da 400.
        await appointmentsApi.update(selectedApp.id, {
          nombre: formData.nombre,
          telefono: formData.telefono,
          phone: formData.telefono,
          resumen: formData.resumen,
          status: formData.status,
          start_time: startTimeISO,
          end_time: endTimeISO,
          ...intake,
        });
        toast.success('Cita actualizada con éxito');
      } else {
        // Create mode
        await appointmentsApi.create({
          account_id: resolvedAccountId,
          nombre: formData.nombre,
          telefono: formData.telefono,
          phone: formData.telefono,
          resumen: formData.resumen,
          status: formData.status,
          start_time: startTimeISO,
          end_time: endTimeISO,
          ...intake,
        });
        toast.success('Cita agendada con éxito');
      }
      setIsModalOpen(false);
      loadAppointments(true);
    } catch (err: any) {
      toast.error('Error al guardar la cita: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getAppsForDay = (date: Date) => {
    return filteredAppointments.filter(app => {
      const appDate = new Date(app.start_time || app.created_at);
      return isSameDay(appDate, date);
    });
  };

  // Estilo de la cita: color POR PROFESIONAL (el estado va en un badge aparte).
  const getEventStyle = (app: Appointment) => {
    const pal = profPalette(orderedProfIds, app.assigned_profile_id);
    return theme === 'light' ? pal.light : pal.dark;
  };

  // Pill de vista Mes: fondo sólido del color del profesional.
  const getMonthPillStyle = (app: Appointment) => {
    const swatch = profPalette(orderedProfIds, app.assigned_profile_id).swatch;
    return `${swatch} text-white hover:opacity-90`;
  };

  // Ícono chico que representa el estado de la cita (el color ya lo da el profesional).
  const StatusBadge = ({ status, size = 11 }: { status: string; size?: number }) => {
    const common = 'inline-flex items-center justify-center rounded-full';
    if (status === 'confirmada') return <span className={`${common} text-emerald-600`} title="Confirmada"><CheckCircle size={size} /></span>;
    if (status === 'cancelada') return <span className={`${common} text-red-600`} title="Cancelada"><XCircle size={size} /></span>;
    if (status === 'asistio') return <span className={`${common} text-blue-600`} title="Asistió"><UserCheck size={size} /></span>;
    if (status === 'no_asistio') return <span className={`${common} text-orange-600`} title="No asistió"><Clock size={size} /></span>;
    if (status === 'cerrado') return <span className={`${common} text-emerald-700`} title="Cerrado"><Check size={size} className="stroke-[3]" /></span>;
    return <span className={`${common} text-amber-600`} title="Pendiente"><Clock size={size} /></span>;
  };

  // Absolute positioning math for events in day/week views
  const getEventLayout = (app: Appointment) => {
    const start = new Date(app.start_time || app.created_at);
    const end = new Date(app.end_time || new Date(start.getTime() + 60 * 60000));
    
    const startHrs = start.getHours() + start.getMinutes() / 60;
    const endHrs = end.getHours() + end.getMinutes() / 60;
    
    // Grid starts at 7 AM
    const top = Math.max(0, (startHrs - 7) * hourHeight);
    const height = Math.max(30, (endHrs - startHrs) * hourHeight); // Min 30px
    
    return { top, height };
  };

  // Overlap management for week columns
  const getPositionedEvents = (day: Date) => {
    const dayApps = getAppsForDay(day).sort(
      (a, b) => new Date(a.start_time || a.created_at).getTime() - new Date(b.start_time || b.created_at).getTime()
    );

    return dayApps.map((app, idx) => {
      const appStart = new Date(app.start_time || app.created_at);
      const appEnd = new Date(app.end_time || new Date(appStart.getTime() + 60 * 60000));
      const { top, height } = getEventLayout(app);
      
      let overlaps = 0;
      let positionIndex = 0;
      
      dayApps.forEach((otherApp, oIdx) => {
        if (otherApp.id === app.id) return;
        const otherStart = new Date(otherApp.start_time || otherApp.created_at);
        const otherEnd = new Date(otherApp.end_time || new Date(otherStart.getTime() + 60 * 60000));
        
        // Check if overlaps
        if (appStart < otherEnd && appEnd > otherStart) {
          overlaps++;
          if (oIdx < idx) {
            positionIndex++;
          }
        }
      });
      
      const width = overlaps > 0 ? `${100 / (overlaps + 1)}%` : 'calc(100% - 6px)';
      const left = overlaps > 0 ? `${(100 / (overlaps + 1)) * positionIndex}%` : '3px';
      
      return { app, top, height, width, left };
    });
  };

  // Red Time Line Math
  const getRedTimeLinePosition = () => {
    const hrs = now.getHours() + now.getMinutes() / 60;
    // 7 AM offset
    return (hrs - 7) * hourHeight;
  };

  // Header Title
  const getHeaderTitle = () => {
    if (view === 'month') {
      return `${months[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
    }
    if (view === 'week') {
      const days = getWeekDays(currentDate);
      const start = days[0];
      const end = days[6];
      if (start.getMonth() === end.getMonth()) {
        return `${months[start.getMonth()]} de ${start.getFullYear()}`;
      }
      return `${months[start.getMonth()]} - ${months[end.getMonth()]} de ${end.getFullYear()}`;
    }
    if (view === 'day') {
      return `${currentDate.getDate()} de ${months[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
    }
    return 'Buscador de Citas';
  };

  return (
    <div className={`flex flex-col lg:flex-row h-[calc(100vh-64px)] overflow-hidden select-none transition-all ${
      theme === 'light' ? 'bg-[#f8f9fa] text-slate-800' : 'bg-brand-dark text-brand-textLight'
    }`}>
      
      {/* 1. LEFT SIDEBAR (Google Calendar Style) */}
      <div className={`w-64 border-r flex flex-col p-4 space-y-6 flex-shrink-0 transition-all select-none overflow-y-auto ${
        theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/5 bg-brand-card/35'
      } ${sidebarOpen ? 'block' : 'hidden'}`}>
        
        {/* BIG "+ CREAR" BUTTON */}
        <button
          onClick={handleOpenNewAppointment}
          className={`flex items-center justify-center gap-3 w-40 px-5 py-4 font-extrabold rounded-[1.75rem] shadow-lg transform hover:-translate-y-0.5 transition-all duration-300 ${
            theme === 'light'
              ? 'bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-blue-500/10 hover:shadow-blue-500/20'
              : 'bg-brand-secondary hover:bg-brand-accent text-brand-dark shadow-brand-secondary/10 hover:shadow-brand-secondary/20'
          }`}
        >
          <Plus size={20} className="stroke-[3]" />
          <span className="text-xs tracking-wider uppercase font-sans">Crear</span>
        </button>

        {/* MINI MONTH CALENDAR PICKER */}
        <div className={`border rounded-2xl p-3.5 ${
          theme === 'light' ? 'bg-slate-50/50 border-slate-200' : 'bg-white/[0.01] border-white/5'
        }`}>
          <div className="flex items-center justify-between mb-3.5">
            <span className={`text-xs font-bold px-1 ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>
              {months[miniDate.getMonth()]} de {miniDate.getFullYear()}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleMiniPrevMonth}
                className={`p-1 rounded-lg transition ${
                  theme === 'light'
                    ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                    : 'hover:bg-white/5 text-brand-textMuted hover:text-white'
                }`}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={handleMiniNextMonth}
                className={`p-1 rounded-lg transition ${
                  theme === 'light'
                    ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                    : 'hover:bg-white/5 text-brand-textMuted hover:text-white'
                }`}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          
          {/* Weekday labels */}
          <div className={`grid grid-cols-7 gap-1 text-center text-[10px] font-bold mb-2 ${
            theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/70'
          }`}>
            {['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S'].map((d, i) => <div key={i}>{d}</div>)}
          </div>
          
          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {getDaysInMonth(miniDate).map((cell, idx) => {
              const isSelected = isSameDay(cell.date, currentDate);
              return (
                <button
                  key={idx}
                  onClick={() => setCurrentDate(cell.date)}
                  className={`w-6 h-6 text-[10px] rounded-full flex items-center justify-center font-semibold transition-all ${
                    !cell.isCurrentMonth
                      ? theme === 'light' ? 'text-slate-300 hover:bg-slate-100' : 'text-brand-textMuted/30 hover:bg-white/5'
                      : isSelected
                        ? theme === 'light' ? 'bg-[#1a73e8] text-white font-bold shadow-md shadow-blue-500/10' : 'bg-brand-secondary text-brand-dark font-bold shadow-md shadow-brand-secondary/20'
                        : cell.isToday
                          ? theme === 'light' ? 'border border-[#1a73e8] text-[#1a73e8] font-bold' : 'border border-brand-secondary text-brand-secondary font-bold'
                          : theme === 'light' ? 'text-slate-600 hover:bg-slate-100' : 'text-brand-textLight hover:bg-white/5'
                  }`}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* AGENDAS (multi-select de profesionales, estilo Google Calendar) */}
        {puedeVerTodasAgendas && professionals.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${
                theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
              }`}>
                <CalendarDays size={10} />
                <span>Agendas</span>
              </h3>
              <button
                onClick={toggleAllProfs}
                className={`text-[10px] font-bold ${theme === 'light' ? 'text-[#1a73e8] hover:underline' : 'text-brand-secondary hover:underline'}`}
              >
                {allSelected ? 'Ninguna' : 'Todas'}
              </button>
            </div>
            <div className="space-y-2.5 px-1 max-h-56 overflow-y-auto scrollbar-thin">
              {professionals.map((p) => {
                const checked = selectedProfs?.has(p.id) ?? true;
                const swatch = profPalette(orderedProfIds, p.id).swatch;
                return (
                  <label key={p.id} className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
                    theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
                  }`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleProf(p.id)} className="sr-only" />
                    <div className={`w-4 h-4 rounded-md flex items-center justify-center transition-all ${
                      checked ? `${swatch} text-white` : theme === 'light' ? 'border border-slate-300 group-hover:border-slate-400' : 'border border-white/20 group-hover:border-white/40'
                    }`}>
                      {checked && <Check size={10} className="stroke-[3]" />}
                    </div>
                    <span className="truncate">{p.name}</span>
                  </label>
                );
              })}
              {/* Sin asignar */}
              {(() => {
                const checked = selectedProfs?.has(UNASSIGNED) ?? true;
                return (
                  <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
                    theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
                  }`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleProf(UNASSIGNED)} className="sr-only" />
                    <div className={`w-4 h-4 rounded-md flex items-center justify-center transition-all ${
                      checked ? 'bg-slate-400 text-white' : theme === 'light' ? 'border border-slate-300 group-hover:border-slate-400' : 'border border-white/20 group-hover:border-white/40'
                    }`}>
                      {checked && <Check size={10} className="stroke-[3]" />}
                    </div>
                    <span className="italic opacity-80">Sin asignar</span>
                  </label>
                );
              })()}
            </div>
          </div>
        )}

        {/* MIS CALENDARIOS (Checkboxes for category filters) */}
        <div className="space-y-3">
          <h3 className={`text-[10px] font-bold uppercase tracking-widest px-1 flex items-center gap-1.5 ${
            theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
          }`}>
            <Filter size={10} />
            <span>Mis Calendarios</span>
          </h3>
          <div className="space-y-2.5 px-1">
            {/* Confirmadas */}
            <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
              theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
            }`}>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={filterConfirmed}
                  onChange={(e) => setFilterConfirmed(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                  filterConfirmed
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : theme === 'light' ? 'border-slate-300 group-hover:border-slate-400' : 'border-white/20 group-hover:border-white/40'
                }`}>
                  {filterConfirmed && <Check size={10} className="stroke-[3]" />}
                </div>
              </div>
              <span>Confirmadas</span>
            </label>

            {/* Pendientes */}
            <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
              theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
            }`}>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={filterPending}
                  onChange={(e) => setFilterPending(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                  filterPending
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : theme === 'light' ? 'border-slate-300 group-hover:border-slate-400' : 'border-white/20 group-hover:border-white/40'
                }`}>
                  {filterPending && <Check size={10} className="stroke-[3]" />}
                </div>
              </div>
              <span>Pendientes</span>
            </label>

            {/* Canceladas */}
            <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
              theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
            }`}>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={filterCanceled}
                  onChange={(e) => setFilterCanceled(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                  filterCanceled
                    ? 'bg-red-500 border-red-500 text-white'
                    : theme === 'light' ? 'border-slate-300 group-hover:border-slate-400' : 'border-white/20 group-hover:border-white/40'
                }`}>
                  {filterCanceled && <Check size={10} className="stroke-[3]" />}
                </div>
              </div>
              <span>Canceladas</span>
            </label>

            {/* Asistió */}
            <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'}`}>
              <div className="relative">
                <input type="checkbox" checked={filterAttended} onChange={(e) => setFilterAttended(e.target.checked)} className="sr-only" />
                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${filterAttended ? 'bg-blue-500 border-blue-500 text-white' : theme === 'light' ? 'border-slate-300 group-hover:border-slate-400' : 'border-white/20 group-hover:border-white/40'}`}>
                  {filterAttended && <Check size={10} className="stroke-[3]" />}
                </div>
              </div>
              <span>Asistió</span>
            </label>

            {/* No asistió */}
            <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'}`}>
              <div className="relative">
                <input type="checkbox" checked={filterNoShow} onChange={(e) => setFilterNoShow(e.target.checked)} className="sr-only" />
                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${filterNoShow ? 'bg-orange-500 border-orange-500 text-white' : theme === 'light' ? 'border-slate-300 group-hover:border-slate-400' : 'border-white/20 group-hover:border-white/40'}`}>
                  {filterNoShow && <Check size={10} className="stroke-[3]" />}
                </div>
              </div>
              <span>No asistió <span className="opacity-60">(recontactar)</span></span>
            </label>

            {/* Cerrado */}
            <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'}`}>
              <div className="relative">
                <input type="checkbox" checked={filterClosed} onChange={(e) => setFilterClosed(e.target.checked)} className="sr-only" />
                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${filterClosed ? 'bg-emerald-600 border-emerald-600 text-white' : theme === 'light' ? 'border-slate-300 group-hover:border-slate-400' : 'border-white/20 group-hover:border-white/40'}`}>
                  {filterClosed && <Check size={10} className="stroke-[3]" />}
                </div>
              </div>
              <span>Cerrado <span className="opacity-60">(caso ganado)</span></span>
            </label>
          </div>
        </div>

      </div>

      {/* 2. MAIN CALENDAR CONTAINER */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* TOP NAVBAR (Exact Google Calendar Controls Layout) */}
        <header className={`h-16 border-b flex items-center justify-between px-4 select-none flex-shrink-0 transition-all ${
          theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/5 bg-brand-dark/20'
        }`}>
          <div className="flex items-center gap-3">
            {/* Hamburger sidebar toggler */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`p-2 rounded-full transition ${
                theme === 'light' ? 'hover:bg-slate-100 text-slate-500 hover:text-slate-800' : 'hover:bg-white/5 text-brand-textMuted hover:text-white'
              }`}
              title="Menú principal"
            >
              <Menu size={18} />
            </button>
            
            <div className="flex items-center gap-2">
              <CalendarDays className={theme === 'light' ? 'text-[#1a73e8]' : 'text-brand-secondary'} size={20} />
              <span className={`text-sm font-bold tracking-tight hidden sm:inline font-sans ${
                theme === 'light' ? 'text-slate-800' : 'text-white'
              }`}>Agenda</span>
            </div>

            {/* Toggle: todas las líneas vs línea activa */}
            <button
              onClick={() => setAllLines(v => !v)}
              title={allLines ? 'Mostrando TODAS las líneas (todos los canales)' : 'Mostrando solo la línea activa'}
              className={`ml-1 px-3 py-1 text-xs font-bold rounded-lg border transition whitespace-nowrap ${
                allLines
                  ? (theme === 'light' ? 'bg-[#1a73e8]/10 text-[#1a73e8] border-[#1a73e8]/30' : 'bg-brand-secondary/15 text-brand-secondary border-brand-secondary/30')
                  : (theme === 'light' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-white/5 text-brand-textMuted border-white/10')
              }`}
            >
              {allLines ? 'Todas las líneas' : 'Línea activa'}
            </button>

            {/* Navigation buttons */}
            <div className={`flex items-center ml-4 gap-1.5 border rounded-xl p-1 transition-all ${
              theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-white/5 border-white/10'
            }`}>
              <button
                onClick={handleToday}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                  theme === 'light'
                    ? 'text-[#1a73e8] hover:bg-white/50'
                    : 'text-brand-secondary hover:text-brand-accent hover:bg-white/5'
                }`}
              >
                Hoy
              </button>
              <div className={`w-px h-4 mx-0.5 ${theme === 'light' ? 'bg-slate-200' : 'bg-white/10'}`} />
              <button
                onClick={handlePrev}
                className={`p-1 rounded-lg transition ${
                  theme === 'light' ? 'hover:bg-slate-200 text-slate-600 hover:text-slate-900' : 'hover:bg-white/5 text-brand-textMuted hover:text-white'
                }`}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={handleNext}
                className={`p-1 rounded-lg transition ${
                  theme === 'light' ? 'hover:bg-slate-200 text-slate-600 hover:text-slate-900' : 'hover:bg-white/5 text-brand-textMuted hover:text-white'
                }`}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            
            {/* Big Date Header */}
            <h1 className={`text-base font-bold ml-3 font-serif ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>
              {getHeaderTitle()}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input inside header */}
            <div className="relative hidden md:block w-60">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/60'
              }`} size={13} />
              <input
                type="text"
                placeholder="Buscar citas..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full border rounded-xl pl-9 pr-3 py-1.5 text-xs focus:outline-none transition-all font-medium ${
                  theme === 'light'
                    ? 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500'
                    : 'bg-white/5 border-white/10 text-white placeholder:text-brand-textMuted/50 focus:ring-1 focus:ring-brand-secondary'
                }`}
              />
            </div>

            {/* Sync Icon */}
            <button
              onClick={() => loadAppointments()}
              className={`p-2 rounded-xl border transition ${
                theme === 'light'
                  ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  : 'bg-white/5 border-white/10 text-brand-textMuted hover:text-brand-secondary'
              }`}
              title="Sincronizar citas"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-brand-secondary' : ''} />
            </button>

            {/* Audit Button */}
            <button
              onClick={runAudit}
              disabled={auditing}
              className={`px-3 py-2 rounded-xl border transition text-xs font-bold disabled:opacity-50 whitespace-nowrap ${
                theme === 'light'
                  ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  : 'bg-white/5 border-white/10 text-brand-textMuted hover:text-brand-secondary'
              }`}
              title="Auditar datos de citas contra el chat"
            >
              {auditing ? 'Auditando…' : '🔍 Auditar'}
            </button>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-xl border transition-all ${
                theme === 'light'
                  ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  : 'bg-white/5 border-white/10 text-brand-textMuted hover:text-brand-secondary'
              }`}
              title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            </button>

            {/* View Switcher Tabs */}
            <div className={`border rounded-xl p-1 flex gap-0.5 ${
              theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-white/5 border-white/10'
            }`}>
              {[
                { id: 'month', label: 'Mes' },
                { id: 'week', label: 'Semana' },
                { id: 'day', label: 'Día' },
                { id: 'list', label: 'Lista' }
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    view === v.id
                      ? theme === 'light'
                        ? 'bg-white text-[#1a73e8] shadow-sm border border-slate-200/50'
                        : 'bg-brand-secondary text-brand-dark shadow-sm'
                      : theme === 'light'
                        ? 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                        : 'text-brand-textMuted hover:text-brand-textLight'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* 3. CALENDAR BODY GRID */}
        <div className={`flex-1 flex flex-col overflow-hidden ${
          theme === 'light' ? 'bg-white' : 'bg-[#0d111c]'
        }`}>
          
          {/* MONTH VIEW */}
          {view === 'month' && (
            <div className="flex-1 flex flex-col overflow-hidden p-3 select-none">
              {/* Day column names */}
              <div className={`grid grid-cols-7 gap-1 text-center text-xs font-bold py-2 ${
                theme === 'light' ? 'text-slate-400 font-bold' : 'text-brand-secondary/70'
              }`}>
                {weekDaysNames.map(d => <div key={d}>{d}</div>)}
              </div>
              {/* Month Cell Grid */}
              <div className={`flex-1 grid grid-cols-7 grid-rows-6 gap-1 border rounded-2xl overflow-hidden shadow-inner ${
                theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-white/[0.02] border-white/5'
              }`}>
                {getDaysInMonth(currentDate).map((cell, idx) => {
                  const dayApps = getAppsForDay(cell.date);
                  return (
                    <div
                      key={idx}
                      onClick={() => handleDayClick(cell.date)}
                      className={`p-1.5 border-r border-b flex flex-col justify-between hover:bg-slate-50/50 cursor-pointer transition-all relative ${
                        theme === 'light' ? 'bg-white border-slate-100' : 'bg-brand-dark/25 border-white/[0.03]'
                      } ${!cell.isCurrentMonth ? 'opacity-35' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center ${
                          cell.isToday
                            ? theme === 'light'
                              ? 'bg-[#1a73e8] text-white rounded-full font-bold shadow-sm shadow-blue-500/20'
                              : 'bg-brand-secondary text-brand-dark rounded-full font-bold shadow-sm shadow-brand-secondary/20'
                            : theme === 'light' ? 'text-slate-500' : 'text-brand-textMuted'
                        }`}>
                          {cell.date.getDate()}
                        </span>
                      </div>
                      
                      {/* Event Pill Row List */}
                      <div className="mt-1 flex-1 overflow-y-auto space-y-0.5 pr-0.5 scrollbar-none max-h-[70px]">
                        {dayApps.map(app => {
                          const appTime = new Date(app.start_time || app.created_at);
                          const hr = `${String(appTime.getHours()).padStart(2, '0')}:${String(appTime.getMinutes()).padStart(2, '0')}`;
                          return (
                            <div
                              key={app.id}
                              onClick={(e) => handleEditClick(app, e)}
                              className={`text-[8.5px] font-bold py-0.5 px-1.5 rounded truncate leading-tight flex items-center gap-1 ${getMonthPillStyle(app)}`}
                              title={`${app.nombre} (${app.status})`}
                            >
                              <span className="font-mono text-[8px] opacity-75">{hr}</span>
                              <span className="truncate flex-1">{app.nombre}</span>
                              {app.tipo_consulta === 'pago' && (
                                <span title={`Consulta paga — cobrar ${fmtMonto(app.monto_a_cobrar ?? 29000)}`} className="text-amber-600 text-[8px] font-black flex-shrink-0">💲</span>
                              )}
                              {(app as any).audit_json?.revisar && (
                                <span title="Datos a revisar" className="text-amber-200 text-[8px] font-bold flex-shrink-0">⚠</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* WEEK VIEW (Google Calendar layout with absolute timeline positioning) */}
          {view === 'week' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Day Columns Header Row */}
              <div className={`grid grid-cols-8 gap-0 text-center select-none border-b py-3 flex-shrink-0 ${
                theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/5 bg-brand-dark/10'
              }`}>
                <div className={`text-[10px] font-bold flex items-center justify-center font-mono ${
                  theme === 'light' ? 'text-slate-400' : 'text-brand-textMuted'
                }`}>GMT-03</div>
                {getWeekDays(currentDate).map((day, idx) => {
                  const isTodayActive = isSameDay(day, new Date());
                  return (
                    <div key={idx} className="flex flex-col items-center">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
                      }`}>{weekDaysNames[idx]}</span>
                      <span className={`text-base font-black mt-1 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        isTodayActive
                          ? theme === 'light' ? 'bg-[#1a73e8] text-white font-extrabold shadow-md shadow-blue-500/20' : 'bg-brand-secondary text-brand-dark font-extrabold shadow-md'
                          : theme === 'light' ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/5'
                      }`}>
                        {day.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Scrollable hourly grid body */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative scrollbar-thin">
                <div className="relative" style={{ height: `${hours.length * hourHeight}px` }}>

                  {/* Grid Lines Layer */}
                  {hours.map((hour, hIdx) => (
                    <div
                      key={hour}
                      className={`absolute left-0 right-0 border-b flex ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`}
                      style={{ top: `${hIdx * hourHeight}px`, height: `${hourHeight}px` }}
                    >
                      <div className={`pointer-events-none absolute left-[12.5%] right-0 border-t border-dashed ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.02]'
                      }`} style={{ top: `${hourHeight / 2}px` }} />
                      {/* Left Hour Label */}
                      <div className={`w-[12.5%] text-[9px] font-bold font-mono pr-3 pt-1 text-right select-none ${
                        theme === 'light' ? 'text-slate-400' : 'text-brand-textMuted/60'
                      }`}>
                        {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                      </div>
                      
                      {/* 7 columns grid lines */}
                      {Array.from({ length: 7 }).map((_, cIdx) => (
                        <div key={cIdx} className={`w-[12.5%] border-r h-full ${
                          theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                        }`} />
                      ))}
                    </div>
                  ))}

                  {/* Absolute Events Columns Overlaid */}
                  <div className="absolute inset-0 flex left-[12.5%]">
                    {getWeekDays(currentDate).map((day, dayIdx) => {
                      const dayEvents = getPositionedEvents(day);
                      const isTodayCol = isSameDay(day, new Date());
                      const redLineTop = getRedTimeLinePosition();
                      
                      return (
                        <div
                          key={dayIdx}
                          onClick={(e) => {
                            // Find click position within the column to infer start hour
                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickY = e.clientY - rect.top;
                            const clickedHour = Math.floor(clickY / hourHeight) + 7;
                            handleSlotClick(day, clickedHour);
                          }}
                          className="w-[14.28%] h-full relative"
                        >
                          {/* Render Events */}
                          {dayEvents.map(({ app, top, height, width, left }) => (
                            <div
                              key={app.id}
                              onClick={(e) => handleEditClick(app, e)}
                              className={`absolute p-2 rounded-xl transition-all cursor-pointer shadow-md select-none overflow-hidden group ${getEventStyle(app)}`}
                              style={{ top: `${top}px`, height: `${height}px`, width, left }}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className={`font-bold text-[10px] leading-tight block truncate ${
                                  theme === 'light' ? 'text-slate-800 font-extrabold' : 'text-white'
                                }`}>{app.nombre}</span>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {app.tipo_consulta === 'pago' && (
                                    <span title={`Consulta paga — cobrar ${fmtMonto(app.monto_a_cobrar ?? 29000)}`} className="text-amber-600 text-[9px] font-black leading-none">💲</span>
                                  )}
                                  {(app as any).audit_json?.revisar && (
                                    <span title="Datos a revisar contra el chat" className="text-amber-600 text-[8px] font-semibold leading-none">⚠</span>
                                  )}
                                  <StatusBadge status={app.status} size={10} />
                                </div>
                              </div>
                              <span className={`text-[8.5px] font-mono opacity-80 block mt-0.5 leading-none ${
                                theme === 'light' ? 'text-slate-600 font-bold' : ''
                              }`}>
                                {new Date(app.start_time || app.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {height > 45 && app.resumen && (
                                <p className={`text-[8px] opacity-70 mt-1 truncate leading-tight ${
                                  theme === 'light' ? 'text-slate-500 font-medium' : ''
                                }`}>{app.resumen}</p>
                              )}
                            </div>
                          ))}

                          {/* Red Time Indicator Line (only on today's column) */}
                          {isTodayCol && redLineTop >= 0 && redLineTop <= hours.length * hourHeight && (
                            <div
                              className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
                              style={{ top: `${redLineTop}px` }}
                            >
                              <div className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-red-500 shadow-md shadow-red-500/50" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              </div>

            </div>
          )}

          {/* DAY VIEW */}
          {view === 'day' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Day title + zoom control */}
              <div className={`border-b py-3 flex-shrink-0 relative text-center select-none ${
                theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/5 bg-brand-dark/10'
              }`}>
                <span className={`text-xs font-bold uppercase tracking-widest block ${
                  theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
                }`}>{weekDaysNames[currentDate.getDay()]}</span>
                <span className={`text-2xl font-black mt-1 block ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>{currentDate.getDate()}</span>
                <div className={`absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 border rounded-xl p-1 ${
                  theme === 'light' ? 'bg-white border-slate-200' : 'bg-white/5 border-white/10'
                }`}>
                  <button onClick={() => zoomBy(-1)} disabled={hourHeight === ZOOM_LEVELS[0]}
                    title="Alejar"
                    className={`p-1 rounded-lg transition disabled:opacity-30 ${theme === 'light' ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-white/10 text-brand-textMuted'}`}>
                    <Minus size={14} />
                  </button>
                  <span className={`text-[10px] font-mono font-bold w-7 text-center ${theme === 'light' ? 'text-slate-500' : 'text-brand-textMuted'}`}>
                    {Math.round((hourHeight / 68) * 100)}%
                  </span>
                  <button onClick={() => zoomBy(1)} disabled={hourHeight === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                    title="Acercar"
                    className={`p-1 rounded-lg transition disabled:opacity-30 ${theme === 'light' ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-white/10 text-brand-textMuted'}`}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* Scrollable single day timeline */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative scrollbar-thin">
                <div className="relative max-w-4xl mx-auto" style={{ height: `${hours.length * hourHeight}px` }}>

                  {/* Grid Lines Layer */}
                  {hours.map((hour, hIdx) => (
                    <div
                      key={hour}
                      className={`absolute left-0 right-0 border-b flex ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`}
                      style={{ top: `${hIdx * hourHeight}px`, height: `${hourHeight}px` }}
                    >
                      <div className={`pointer-events-none absolute left-20 right-0 border-t border-dashed ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.02]'
                      }`} style={{ top: `${hourHeight / 2}px` }} />
                      <div className={`w-20 text-[10px] font-bold font-mono pr-4 pt-1 text-right select-none ${
                        theme === 'light' ? 'text-slate-400' : 'text-brand-textMuted/60'
                      }`}>
                        {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                      </div>
                      <div className={`flex-1 border-l ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`} />
                    </div>
                  ))}

                  {/* Absolute Day Column Container */}
                  <div
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickY = e.clientY - rect.top;
                      const clickedHour = Math.floor(clickY / hourHeight) + 7;
                      handleSlotClick(currentDate, clickedHour);
                    }}
                    className="absolute inset-y-0 left-20 right-4"
                  >
                    {/* Events list */}
                    {getPositionedEvents(currentDate).map(({ app, top, height, width, left }) => (
                      <div
                        key={app.id}
                        onClick={(e) => handleEditClick(app, e)}
                        className={`absolute p-3 rounded-2xl transition-all cursor-pointer shadow-md select-none overflow-hidden group ${getEventStyle(app)}`}
                        style={{ top: `${top}px`, height: `${height}px`, width, left }}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-xs block ${
                            theme === 'light' ? 'text-slate-800 font-extrabold' : 'text-white'
                          }`}>{app.nombre}</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {(app as any).audit_json?.revisar && (
                              <span title="Datos a revisar contra el chat" className="text-amber-600 text-xs font-semibold">⚠</span>
                            )}
                            <StatusBadge status={app.status} size={14} />
                          </div>
                        </div>
                        <div className={`flex items-center gap-1.5 mt-1 text-[10px] opacity-80 font-mono ${
                          theme === 'light' ? 'text-slate-600 font-bold' : ''
                        }`}>
                          <Phone size={10} />
                          <span>{app.telefono || app.phone}</span>
                        </div>
                        {app.resumen && (
                          <p className={`text-[10px] opacity-70 mt-2 leading-relaxed border-t pt-1.5 ${
                            theme === 'light' ? 'text-slate-500 border-slate-200/50' : 'border-white/5'
                          }`}>{app.resumen}</p>
                        )}
                      </div>
                    ))}

                    {/* Red Line */}
                    {isSameDay(currentDate, new Date()) && getRedTimeLinePosition() >= 0 && (
                      <div
                        className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
                        style={{ top: `${getRedTimeLinePosition()}px` }}
                      >
                        <div className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-red-500 shadow-md shadow-red-500/50" />
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* LIST VIEW (Search List Cards) */}
          {view === 'list' && (
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {filteredAppointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4 select-none">
                  <div className={`w-16 h-16 rounded-xl flex items-center justify-center mb-4 ${
                    theme === 'light' ? 'bg-brand-primary/[0.07] text-brand-primary' : 'bg-white/[0.02] border border-white/5 text-brand-secondary/40'
                  }`}>
                    <CalendarIcon size={32} />
                  </div>
                  <h3 className={`font-serif font-bold text-base mb-1 ${theme === 'light' ? 'text-brand-ink' : 'text-white'}`}>No hay citas registradas</h3>
                  <p className={`text-xs max-w-sm leading-relaxed ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}`}>
                    No se encontraron citas para los criterios de búsqueda y filtros aplicados.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl mx-auto">
                  {filteredAppointments.map((app) => (
                    <div
                      key={app.id}
                      onClick={() => handleEditClick(app)}
                      className={`rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden group cursor-pointer border ${
                        theme === 'light'
                          ? 'bg-brand-surface border-brand-hairline shadow-card hover:shadow-md'
                          : 'glass-card border-white/5'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <h3 className={`font-serif font-bold text-base leading-tight transition-colors duration-300 ${
                              theme === 'light' ? 'text-brand-ink group-hover:text-brand-primary' : 'text-white group-hover:text-brand-secondary'
                            }`}>{app.nombre}</h3>
                            {(app as any).audit_json?.revisar && (
                              <span title="Datos a revisar contra el chat" className="inline-block ml-0 mt-0.5 text-amber-600 text-xs font-semibold">⚠ revisar</span>
                            )}
                            <div className={`flex items-center gap-1.5 text-xs mt-1.5 font-mono ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}`}>
                              <Phone size={12} className={theme === 'light' ? 'text-brand-primary' : 'text-brand-secondary/70'} />
                              <span>{app.phone}</span>
                            </div>
                            {app.assigned_profile_id && (
                              <div className={`text-[10px] mt-1 ${theme === 'light' ? 'text-brand-primary' : 'text-brand-secondary'}`}>
                                {professionals.find((p) => p.id === app.assigned_profile_id)?.name || 'Asignada'}
                              </div>
                            )}
                          </div>

                          <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            app.status === 'confirmada' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            app.status === 'cancelada' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            app.status === 'asistio' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            app.status === 'no_asistio' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                            app.status === 'cerrado' ? 'bg-emerald-600/15 text-emerald-400 border border-emerald-600/30' :
                            'bg-brand-secondary/15 text-brand-secondary border border-brand-secondary/20'
                          }`}>
                            {statusLabel[app.status] || app.status}
                          </span>
                        </div>

                        {app.resumen && (
                          <div className={`border rounded-xl p-3.5 mb-4 ${
                            theme === 'light' ? 'bg-brand-ivory border-brand-hairline' : 'bg-brand-dark/40 border-white/5'
                          }`}>
                            <div className={`flex items-center gap-1.5 mb-1.5 text-[9px] font-bold uppercase tracking-widest ${
                              theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                            }`}>
                              <Shield size={10} />
                              <span>Resumen de consulta</span>
                            </div>
                            <p className={`text-xs leading-relaxed font-medium ${
                              theme === 'light' ? 'text-brand-ink' : 'text-brand-textMuted'
                            }`}>{app.resumen}</p>
                          </div>
                        )}
                      </div>

                      <div className={`border-t pt-4 mt-2 ${theme === 'light' ? 'border-brand-hairline' : 'border-white/5'}`}>
                        <div className="flex items-center justify-between mb-4">
                          <span className={`text-[10px] flex items-center gap-1 font-semibold ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}`}>
                            <Clock size={12} className={theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/60'} />
                            <span>{new Date(app.start_time || app.created_at).toLocaleDateString()} · {new Date(app.start_time || app.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </span>
                          <span className={`text-[10px] ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}`}>{formatDistanceToNow(new Date(app.created_at))}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          {app.status === 'pendiente' && (
                            <button
                                onClick={() => handleUpdateStatus(app.id, 'confirmada')}
                                className="flex items-center gap-1 text-[11px] font-bold py-2 px-2.5 rounded-lg border bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                            >
                              <CheckCircle size={12} /><span>Confirmar</span>
                            </button>
                          )}

                          {app.status !== 'cerrado' && app.status !== 'cancelada' && (
                            <>
                              <button onClick={() => handleUpdateStatus(app.id, 'asistio')} title="Asistió a la cita"
                                className="flex items-center gap-1 text-[11px] font-bold py-2 px-2.5 rounded-lg border bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200">
                                <UserCheck size={12} /><span>Asistió</span>
                              </button>
                              <button onClick={() => handleUpdateStatus(app.id, 'no_asistio')} title="No asistió — recontactar"
                                className="flex items-center gap-1 text-[11px] font-bold py-2 px-2.5 rounded-lg border bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200">
                                <Clock size={12} /><span>No asistió</span>
                              </button>
                              <button onClick={() => handleUpdateStatus(app.id, 'cerrado')} title="Caso cerrado (ganado)"
                                className="flex items-center gap-1 text-[11px] font-bold py-2 px-2.5 rounded-lg border bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-700 border-emerald-600/30">
                                <Check size={12} /><span>Cerrado</span>
                              </button>
                              {app.status === 'pendiente' && (
                                <button onClick={() => handleUpdateStatus(app.id, 'cancelada')} title="Cancelar cita"
                                  className="flex items-center gap-1 text-[11px] font-bold py-2 px-2.5 rounded-lg border bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/20">
                                  <XCircle size={12} /><span>Cancelar</span>
                                </button>
                              )}
                            </>
                          )}

                          {(app.status === 'cerrado' || app.status === 'cancelada') && (
                            <div className="flex items-center gap-1.5 text-[11px] text-brand-textMuted italic py-2 px-1">
                              <UserCheck size={12} className="text-brand-secondary/50" />
                              <span>Marcada como {statusLabel[app.status]}</span>
                            </div>
                          )}

                          <button
                            onClick={() => handleDelete(app.id)}
                            className={`p-2.5 rounded-xl border transition-all duration-300 ${
                              theme === 'light'
                                ? 'bg-brand-ivory hover:bg-red-50 text-brand-inkmuted hover:text-red-500 border-brand-hairline hover:border-red-200'
                                : 'bg-white/5 hover:bg-red-500/10 text-brand-textMuted hover:text-red-400 border-white/5 hover:border-red-500/10'
                            }`}
                            title="Eliminar de la agenda"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      {/* CREATE & EDIT MODAL (Unified Dialog Window) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in select-none">
          <div className={`w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden p-6 relative ${
            theme === 'light'
              ? 'bg-brand-surface rounded-2xl border border-brand-hairline shadow-card'
              : 'bg-brand-card rounded-2xl border border-white/10 shadow-2xl'
          }`}>
            <div className={`absolute top-0 left-0 right-0 h-1 ${theme === 'light' ? 'bg-brand-primary' : 'hidden'}`} />

            {/* Modal Header */}
            <div className={`flex-shrink-0 flex items-center justify-between border-b pb-4 mb-4 ${
              theme === 'light' ? 'border-brand-hairline' : 'border-white/5'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  theme === 'light'
                    ? 'bg-brand-primary/[0.07] text-brand-primary'
                    : 'bg-brand-secondary/15 text-brand-secondary border border-brand-secondary/20'
                }`}>
                  {selectedApp ? <FileText size={18} /> : <Plus size={18} />}
                </div>
                <div>
                  <h2 className={`text-lg font-serif font-bold ${theme === 'light' ? 'text-brand-ink' : 'text-white'}`}>{selectedApp ? 'Detalles de la Cita' : 'Nueva Cita'}</h2>
                  <p className={`text-[10px] mt-0.5 ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}`}>Programar o modificar consulta jurídica</p>
                </div>
              </div>

              <button
                onClick={() => setIsModalOpen(false)}
                className={`text-xs font-semibold p-1 rounded-lg transition-all ${
                  theme === 'light' ? 'text-brand-inkmuted hover:text-brand-ink hover:bg-brand-panel' : 'text-brand-textMuted hover:text-white hover:bg-white/5'
                }`}
              >
                Cerrar
              </button>
            </div>

            {/* Badge de cobro — PROMINENTE: la empleada debe saber que la consulta es paga antes de llamar. */}
            {selectedApp?.tipo_consulta === 'pago' && (
              <div className={`flex-shrink-0 mb-4 flex items-center gap-2 px-3 py-2.5 rounded-xl border font-bold text-sm ${
                theme === 'light'
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-amber-500/15 text-amber-200 border-amber-500/40'
              }`}>
                <span className="text-base leading-none">⚠</span>
                <span>CONSULTA PAGA — COBRAR {fmtMonto(selectedApp.monto_a_cobrar ?? 29000)}</span>
              </div>
            )}
            {selectedApp?.tipo_consulta === 'gratis' && (
              <div className={`flex-shrink-0 mb-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold w-fit ${
                theme === 'light'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              }`}>
                <CheckCircle size={12} />
                <span>Consulta gratuita</span>
              </div>
            )}

            {/* Datos de calificación (read-only) — contexto para la empleada. */}
            {selectedApp && (() => {
              const datos: { label: string; value: string }[] = [];
              if (selectedApp.area) datos.push({ label: 'Área', value: selectedApp.area });
              if (selectedApp.edad != null) datos.push({ label: 'Edad', value: String(selectedApp.edad) });
              if (selectedApp.zona) datos.push({ label: 'Zona', value: selectedApp.zona });
              if (selectedApp.nacionalidad) datos.push({ label: 'Nacionalidad', value: selectedApp.nacionalidad });
              if (selectedApp.insalubres != null) datos.push({ label: 'Insalubres', value: selectedApp.insalubres ? 'Sí' : 'No' });
              if (selectedApp.aportes_aprox != null) datos.push({ label: 'Aportes aprox.', value: String(selectedApp.aportes_aprox) });
              if (!datos.length) return null;
              return (
                <div className={`flex-shrink-0 mb-4 rounded-xl border px-3 py-2.5 ${
                  theme === 'light' ? 'bg-brand-panel border-brand-hairline' : 'bg-brand-dark/40 border-white/10'
                }`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>Datos de calificación</p>
                  <div className="flex flex-wrap gap-1.5">
                    {datos.map((d) => (
                      <span key={d.label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium ${
                        theme === 'light' ? 'bg-brand-ivory text-brand-ink border border-brand-hairline' : 'bg-white/5 text-white/90 border border-white/10'
                      }`}>
                        <span className={theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}>{d.label}:</span>
                        <span className="font-semibold">{d.value}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 -mr-3 pr-3 scrollbar-thin">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Nombre */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <User size={10} />
                    <span>Nombre del Cliente</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nombre}
                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                    placeholder="Ej. Juan Pérez"
                  />
                </div>

                {/* Teléfono */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <Phone size={10} />
                    <span>Teléfono / WhatsApp</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.telefono}
                    onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all font-mono ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                    placeholder="Ej. +54911223344"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Fecha */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <CalendarIcon size={10} />
                    <span>Fecha Cita</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                  />
                </div>

                {/* Hora Inicio */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <Clock size={10} />
                    <span>Hora Inicio</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.startHour}
                    onChange={(e) => setFormData({ ...formData, startHour: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                  />
                </div>

                {/* Hora Fin */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <Clock size={10} />
                    <span>Hora Fin</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.endHour}
                    onChange={(e) => setFormData({ ...formData, endHour: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Status */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <Info size={10} />
                    <span>Estado Cita</span>
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                  >
                    <option value="pendiente" className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>Pendiente</option>
                    <option value="confirmada" className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>Confirmada</option>
                    <option value="cancelada" className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>Cancelada</option>
                    <option value="asistio" className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>Asistió</option>
                    <option value="no_asistio" className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>No asistió (recontactar)</option>
                    <option value="cerrado" className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>Cerrado (caso ganado)</option>
                  </select>
                </div>

                {/* Account ID Selector */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <User size={10} />
                    <span>Asignar a Cuenta</span>
                  </label>
                  <select
                    value={formData.account_id}
                    onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 transition-all ${
                      theme === 'light'
                        ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                  >
                    <option value="" disabled>Seleccionar cuenta...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id} className={theme === 'light' ? 'bg-white' : 'bg-brand-card'}>
                        {acc.name} ({acc.phone_number || 'Sin número'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Resumen / Descripción */}
              <div className="space-y-1">
                <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                  theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                }`}>
                  <Shield size={10} />
                  <span>Resumen / Notas del Caso</span>
                </label>
                <textarea
                  value={formData.resumen}
                  onChange={(e) => setFormData({ ...formData, resumen: e.target.value })}
                  className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all min-h-[80px] ${
                    theme === 'light'
                      ? 'bg-brand-ivory border-brand-hairline text-brand-ink focus:bg-brand-surface focus:ring-brand-primary/40 focus:border-brand-primary'
                      : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                  }`}
                  placeholder="Detalles sobre la consulta del cliente..."
                />
              </div>

              {/* Ficha de recepción (planilla): se llena mientras se atiende */}
              <div className={`space-y-3 border rounded-xl p-3 ${
                theme === 'light' ? 'border-brand-hairline bg-brand-ivory/40' : 'border-white/10 bg-brand-dark/30'
              }`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                  theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                }`}>
                  <FileText size={10} />
                  <span>Ficha de recepción</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Motivo */}
                  <FieldSelect
                    theme={theme} label="Motivo" value={formData.motivo}
                    onChange={(v) => setFormData({ ...formData, motivo: v as AppointmentMotivo | '' })}
                    options={Object.entries(MOTIVO_LABELS)}
                  />
                  {/* DNI */}
                  <FieldText
                    theme={theme} label="DNI" value={formData.dni} placeholder="20-12345678-9"
                    onChange={(v) => setFormData({ ...formData, dni: v })}
                  />
                  {/* Cómo nos conoció / canal */}
                  <FieldSelect
                    theme={theme} label="Cómo nos conoció" value={formData.canal_origen}
                    onChange={(v) => setFormData({ ...formData, canal_origen: v as AppointmentCanal | '' })}
                    options={Object.entries(CANAL_LABELS)}
                    hint={formData.canal_auto && formData.canal_origen ? 'auto' : undefined}
                  />
                  {/* Resultado */}
                  <FieldSelect
                    theme={theme} label="Resultado" value={formData.resultado}
                    onChange={(v) => setFormData({ ...formData, resultado: v as AppointmentResultado | '' })}
                    options={Object.entries(RESULTADO_LABELS)}
                  />
                </div>

                {/* Faltante */}
                <FieldText
                  theme={theme} label="Documentación faltante" value={formData.faltante}
                  placeholder="Clave ANSES, certificación IERIC…"
                  onChange={(v) => setFormData({ ...formData, faltante: v })}
                />

                {/* Seguimiento */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>Seguimiento</label>
                  <textarea
                    value={formData.seguimiento}
                    onChange={(e) => setFormData({ ...formData, seguimiento: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all min-h-[60px] ${
                      theme === 'light'
                        ? 'bg-brand-surface border-brand-hairline text-brand-ink focus:ring-brand-primary/40 focus:border-brand-primary'
                        : 'bg-brand-dark/60 border-white/10 text-white focus:ring-brand-secondary/50 focus:border-brand-secondary/50'
                    }`}
                    placeholder="Llamé, quedó en traer la clave; recontactar en 1 mes…"
                  />
                </div>

                {/* Carpeta */}
                <label className={`flex items-center gap-2 text-xs cursor-pointer ${
                  theme === 'light' ? 'text-brand-ink' : 'text-white'
                }`}>
                  <input
                    type="checkbox"
                    checked={formData.carpeta}
                    onChange={(e) => setFormData({ ...formData, carpeta: e.target.checked })}
                    className="rounded"
                  />
                  <span>Carpeta armada</span>
                </label>
              </div>

              {/* Auditoría: diferencias entre datos de la cita y el chat */}
              {selectedApp && (selectedApp as any).audit_json?.campos?.some((c: any) => !c.coincide && !c.resuelto) && (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <div className="font-semibold text-amber-800 mb-2">⚠ Auditoría: datos a revisar</div>
                  {(selectedApp as any).audit_json.campos
                    .filter((c: any) => !c.coincide && !c.resuelto)
                    .map((c: any) => {
                      // Solo estos campos se pueden aplicar con 1 clic (la fecha se corrige a mano:
                      // la ruta no la escribe y un string de fecha no es seguro de aplicar automático).
                      const aplicable = ['telefono', 'nombre', 'motivo', 'oficina'].includes(c.campo) && !!c.sugerencia;
                      return (
                        <div key={c.campo} className="flex items-center justify-between gap-2 py-1 text-sm">
                          <div>
                            <b>{c.campo}</b>:{' '}
                            <span className="line-through text-gray-500">{c.valor_cita ?? '—'}</span>
                            {c.sugerencia && <> → <span className="text-emerald-700">{c.sugerencia}</span></>}
                            {c.nota && <div className="text-xs text-gray-500">{c.nota}</div>}
                            {!aplicable && <div className="text-xs text-amber-700">Revisá y corregí a mano si corresponde.</div>}
                          </div>
                          {aplicable && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await appointmentsApi.applyAuditFix(selectedApp.id, c.campo);
                                  toast.success('Aplicado');
                                  loadAppointments(true);
                                  setIsModalOpen(false);
                                } catch (err: any) {
                                  toast.error(err.message);
                                }
                              }}
                              className="px-2 py-1 rounded bg-emerald-600 text-white text-xs whitespace-nowrap"
                            >
                              Aplicar
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Profesional asignado (reasignar — solo admin, citas existentes) */}
              {selectedApp && role === 'admin' && (
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'}`}>
                    <User size={10} />
                    <span>Profesional asignado</span>
                  </label>
                  <select
                    value={selectedApp.assigned_profile_id ?? ''}
                    onChange={(e) => handleAssign(selectedApp.id, e.target.value || null)}
                    className={`w-full border rounded-xl px-3 py-2 text-xs ${theme === 'light' ? 'bg-brand-ivory border-brand-hairline text-brand-ink' : 'bg-brand-dark/60 border-white/10 text-white'}`}
                  >
                    <option value="">Sin asignar</option>
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Llamar / Videollamar (solo en citas existentes) */}
              {selectedApp && (
                <div className="space-y-2">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                    theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'
                  }`}>
                    <Phone size={10} />
                    <span>Llamar / Videollamar</span>
                  </label>
                  <CallActions
                    target={{ account_id: selectedApp.account_id, phone: selectedApp.phone, telefono: selectedApp.telefono, nombre: selectedApp.nombre }}
                    provider={accounts.find(a => a.id === selectedApp.account_id)?.provider}
                  />
                </div>
              )}

              {/* Modal Actions */}
              <div className={`flex items-center justify-between border-t pt-4 mt-6 ${
                theme === 'light' ? 'border-brand-hairline' : 'border-white/5'
              }`}>
                <div className="flex gap-2">
                  {selectedApp && (
                    <button
                      type="button"
                      onClick={() => handleDelete(selectedApp.id)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-xl border border-red-500/20 transition-all"
                    >
                      <Trash2 size={13} />
                      <span>Eliminar Cita</span>
                    </button>
                  )}
                  {selectedApp && (selectedApp.phone || selectedApp.telefono) && (
                    <button
                      type="button"
                      onClick={() => goToChat(selectedApp)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary text-xs font-bold rounded-xl border border-brand-primary/20 transition-all"
                    >
                      <MessageSquare size={13} />
                      <span>Ir al chat</span>
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all ${
                      theme === 'light'
                        ? 'bg-brand-panel hover:bg-brand-ivory text-brand-ink border-brand-hairline'
                        : 'bg-white/5 hover:bg-white/10 text-brand-textLight border-white/5'
                    }`}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`px-4 py-2 text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      theme === 'light'
                        ? 'bg-brand-primary hover:bg-brand-primary/90 text-white shadow-brand-primary/10'
                        : 'bg-brand-secondary hover:bg-brand-accent text-brand-dark shadow-brand-secondary/10'
                    }`}
                  >
                    {submitting ? 'Guardando…' : (selectedApp ? 'Guardar Cambios' : 'Agendar Cita')}
                  </button>
                </div>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Popup recordatorio de cita + botones de llamada */}
      <CallReminderModal
        appointments={appointments}
        provider={accounts.find(a => a.id === activeAccountId)?.provider}
      />

    </div>
  );
}
