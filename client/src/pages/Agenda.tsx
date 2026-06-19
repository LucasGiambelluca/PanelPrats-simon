import { useState, useEffect, useRef } from 'react';
import { useAccounts } from '../context/AccountContext';
import { appointmentsApi, Appointment } from '../lib/api';
import CallReminderModal from '../components/CallReminderModal';
import CallActions from '../components/CallActions';
import { toast } from 'sonner';
import {
  Calendar as CalendarIcon, CheckCircle, XCircle, Clock, Trash2, Search, RefreshCw,
  Phone, UserCheck, Shield, Plus, ChevronLeft, ChevronRight, Info, User,
  FileText, Menu, Check, Filter, CalendarDays, Sun, Moon
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

const months = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const weekDaysNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7:00 to 22:00
const HOUR_HEIGHT = 68; // height in pixels of an hour row

export default function Agenda() {
  const { activeAccountId, accounts } = useAccounts();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
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
  const [miniDate, setMiniDate] = useState<Date>(new Date());

  // Real-time indicator
  const [now, setNow] = useState<Date>(new Date());

  // Modal settings
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
      // 8 AM is index 1 from 7 AM, so 1 * 68 = 68px
      scrollContainerRef.current.scrollTop = 68;
    }
  }, [view]);

  // Load appointments
  const loadAppointments = async (silent = false) => {
    if (!activeAccountId) return;
    if (!silent) setLoading(true);
    try {
      const data = await appointmentsApi.list(activeAccountId);
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
      loadAppointments(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeAccountId]);

  // Synchronize mini calendar selected month when main calendar date changes
  useEffect(() => {
    setMiniDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  }, [currentDate]);

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

    return matchesSearch && matchesStatusFilter;
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
      account_id: activeAccountId || '',
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
      account_id: activeAccountId || '',
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
    });
    setIsModalOpen(true);
  };

  const handleOpenNewAppointment = () => {
    handleDayClick(currentDate);
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

    try {
      setSubmitting(true);
      const startTimeISO = new Date(`${formData.date}T${formData.startHour}`).toISOString();
      const endTimeISO = new Date(`${formData.date}T${formData.endHour}`).toISOString();
      if (new Date(endTimeISO).getTime() <= new Date(startTimeISO).getTime()) {
        toast.error('La hora de fin debe ser posterior a la de inicio');
        return;
      }

      if (selectedApp) {
        // Edit mode
        await appointmentsApi.update(selectedApp.id, {
          nombre: formData.nombre,
          telefono: formData.telefono,
          phone: formData.telefono,
          resumen: formData.resumen,
          status: formData.status,
          start_time: startTimeISO,
          end_time: endTimeISO,
          account_id: formData.account_id || activeAccountId || '',
        });
        toast.success('Cita actualizada con éxito');
      } else {
        // Create mode
        await appointmentsApi.create({
          account_id: formData.account_id || activeAccountId || '',
          nombre: formData.nombre,
          telefono: formData.telefono,
          phone: formData.telefono,
          resumen: formData.resumen,
          status: formData.status,
          start_time: startTimeISO,
          end_time: endTimeISO,
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

  // Google Calendar Event Style Generator (Theme Aware)
  const getEventStyle = (status: string) => {
    if (theme === 'light') {
      if (status === 'confirmada') return 'bg-[#e6f4ea] border-l-[4px] border-[#137333] text-[#137333] hover:bg-[#137333]/10';
      if (status === 'cancelada') return 'bg-[#fce8e6] border-l-[4px] border-[#c5221f] text-[#c5221f] hover:bg-[#c5221f]/10';
      if (status === 'asistio') return 'bg-[#e8f0fe] border-l-[4px] border-[#1a73e8] text-[#1a73e8] hover:bg-[#1a73e8]/10';
      if (status === 'no_asistio') return 'bg-[#fff3e0] border-l-[4px] border-[#e8710a] text-[#b45309] hover:bg-[#e8710a]/10';
      if (status === 'cerrado') return 'bg-[#e6f4ea] border-l-[4px] border-emerald-700 text-emerald-800 hover:bg-emerald-700/10';
      return 'bg-[#fef7e0] border-l-[4px] border-[#b06000] text-[#b06000] hover:bg-[#b06000]/10';
    } else {
      if (status === 'confirmada') return 'bg-emerald-500/10 border-l-[4px] border-emerald-500 text-emerald-400 hover:bg-emerald-500/20';
      if (status === 'cancelada') return 'bg-red-500/10 border-l-[4px] border-red-500 text-red-400 hover:bg-red-500/20';
      if (status === 'asistio') return 'bg-blue-500/10 border-l-[4px] border-blue-500 text-blue-400 hover:bg-blue-500/20';
      if (status === 'no_asistio') return 'bg-orange-500/10 border-l-[4px] border-orange-500 text-orange-400 hover:bg-orange-500/20';
      if (status === 'cerrado') return 'bg-emerald-600/15 border-l-[4px] border-emerald-600 text-emerald-300 hover:bg-emerald-600/25';
      return 'bg-amber-500/10 border-l-[4px] border-amber-500 text-amber-400 hover:bg-amber-500/20';
    }
  };

  const getMonthPillStyle = (status: string) => {
    if (theme === 'light') {
      if (status === 'confirmada') return 'bg-[#137333] text-white hover:bg-[#0f5927]';
      if (status === 'cancelada') return 'bg-[#c5221f] text-white hover:bg-[#a11b19]';
      if (status === 'asistio') return 'bg-[#1a73e8] text-white hover:bg-[#1557b0]';
      if (status === 'no_asistio') return 'bg-[#e8710a] text-white hover:bg-[#b45309]';
      if (status === 'cerrado') return 'bg-emerald-700 text-white hover:bg-emerald-800';
      return 'bg-[#b06000] text-white hover:bg-[#8e4d00]';
    } else {
      if (status === 'confirmada') return 'bg-emerald-600/80 hover:bg-emerald-600 text-white';
      if (status === 'cancelada') return 'bg-red-600/80 hover:bg-red-600 text-white';
      if (status === 'asistio') return 'bg-blue-600/80 hover:bg-blue-600 text-white';
      if (status === 'no_asistio') return 'bg-orange-600/80 hover:bg-orange-600 text-white';
      if (status === 'cerrado') return 'bg-emerald-700/90 hover:bg-emerald-700 text-white';
      return 'bg-amber-600/80 hover:bg-amber-600 text-white';
    }
  };

  // Absolute positioning math for events in day/week views
  const getEventLayout = (app: Appointment) => {
    const start = new Date(app.start_time || app.created_at);
    const end = new Date(app.end_time || new Date(start.getTime() + 60 * 60000));
    
    const startHrs = start.getHours() + start.getMinutes() / 60;
    const endHrs = end.getHours() + end.getMinutes() / 60;
    
    // Grid starts at 7 AM
    const top = Math.max(0, (startHrs - 7) * HOUR_HEIGHT);
    const height = Math.max(30, (endHrs - startHrs) * HOUR_HEIGHT); // Min 30px
    
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
    return (hrs - 7) * HOUR_HEIGHT;
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
            {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => <div key={d}>{d}</div>)}
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
                              className={`text-[8.5px] font-bold py-0.5 px-1.5 rounded truncate leading-tight flex items-center gap-1 ${getMonthPillStyle(app.status)}`}
                              title={`${app.nombre} (${app.status})`}
                            >
                              <span className="font-mono text-[8px] opacity-75">{hr}</span>
                              <span>{app.nombre}</span>
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
                <div className="relative" style={{ height: `${hours.length * HOUR_HEIGHT}px` }}>
                  
                  {/* Grid Lines Layer */}
                  {hours.map((hour, hIdx) => (
                    <div
                      key={hour}
                      className={`absolute left-0 right-0 border-b flex ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`}
                      style={{ top: `${hIdx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                    >
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
                            const clickedHour = Math.floor(clickY / HOUR_HEIGHT) + 7;
                            handleSlotClick(day, clickedHour);
                          }}
                          className="w-[14.28%] h-full relative"
                        >
                          {/* Render Events */}
                          {dayEvents.map(({ app, top, height, width, left }) => (
                            <div
                              key={app.id}
                              onClick={(e) => handleEditClick(app, e)}
                              className={`absolute p-2 rounded-xl transition-all cursor-pointer shadow-md select-none overflow-hidden group ${getEventStyle(app.status)}`}
                              style={{ top: `${top}px`, height: `${height}px`, width, left }}
                            >
                              <div className="flex items-start justify-between">
                                <span className={`font-bold text-[10px] leading-tight block truncate ${
                                  theme === 'light' ? 'text-slate-800 font-extrabold' : 'text-white'
                                }`}>{app.nombre}</span>
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
                          {isTodayCol && redLineTop >= 0 && redLineTop <= hours.length * HOUR_HEIGHT && (
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
              {/* Day title */}
              <div className={`border-b py-3 flex-shrink-0 text-center select-none ${
                theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/5 bg-brand-dark/10'
              }`}>
                <span className={`text-xs font-bold uppercase tracking-widest block ${
                  theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
                }`}>{weekDaysNames[currentDate.getDay()]}</span>
                <span className={`text-2xl font-black mt-1 block ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>{currentDate.getDate()}</span>
              </div>

              {/* Scrollable single day timeline */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative scrollbar-thin">
                <div className="relative max-w-4xl mx-auto" style={{ height: `${hours.length * HOUR_HEIGHT}px` }}>
                  
                  {/* Grid Lines Layer */}
                  {hours.map((hour, hIdx) => (
                    <div
                      key={hour}
                      className={`absolute left-0 right-0 border-b flex ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`}
                      style={{ top: `${hIdx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                    >
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
                      const clickedHour = Math.floor(clickY / HOUR_HEIGHT) + 7;
                      handleSlotClick(currentDate, clickedHour);
                    }}
                    className="absolute inset-y-0 left-20 right-4"
                  >
                    {/* Events list */}
                    {getPositionedEvents(currentDate).map(({ app, top, height, width, left }) => (
                      <div
                        key={app.id}
                        onClick={(e) => handleEditClick(app, e)}
                        className={`absolute p-3 rounded-2xl transition-all cursor-pointer shadow-md select-none overflow-hidden group ${getEventStyle(app.status)}`}
                        style={{ top: `${top}px`, height: `${height}px`, width, left }}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-xs block ${
                            theme === 'light' ? 'text-slate-800 font-extrabold' : 'text-white'
                          }`}>{app.nombre}</span>
                          <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${
                            theme === 'light'
                              ? app.status === 'confirmada' ? 'bg-[#137333]/15 text-[#137333]'
                                : app.status === 'cancelada' ? 'bg-[#c5221f]/15 text-[#c5221f]'
                                : 'bg-[#b06000]/15 text-[#b06000]'
                              : 'bg-black/25 text-white'
                          }`}>
                            {app.status}
                          </span>
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
                      <div className="absolute top-0 right-0 w-24 h-24 bg-brand-secondary/5 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 animate-pulse" />
                      
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <h3 className={`font-serif font-bold text-base leading-tight transition-colors duration-300 ${
                              theme === 'light' ? 'text-brand-ink group-hover:text-brand-primary' : 'text-white group-hover:text-brand-secondary'
                            }`}>{app.nombre}</h3>
                            <div className={`flex items-center gap-1.5 text-xs mt-1.5 font-mono ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-textMuted'}`}>
                              <Phone size={12} className={theme === 'light' ? 'text-brand-primary' : 'text-brand-secondary/70'} />
                              <span>{app.phone}</span>
                            </div>
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
                            <Clock size={12} className={theme === 'light' ? 'text-brand-gold' : 'text-brand-secondary/60'} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
          <div className={`w-full max-w-lg overflow-hidden p-6 relative ${
            theme === 'light'
              ? 'bg-brand-surface rounded-2xl border border-brand-hairline shadow-card'
              : 'bg-brand-card/95 rounded-3xl border border-white/10 shadow-2xl'
          }`}>
            <div className={`absolute top-0 left-0 right-0 h-1 ${theme === 'light' ? 'bg-brand-primary' : 'hidden'}`} />
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-secondary/5 rounded-full blur-3xl pointer-events-none" />

            {/* Modal Header */}
            <div className={`flex items-center justify-between border-b pb-4 mb-4 ${
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

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
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
                <div>
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
