import { useState, useEffect } from 'react';
import { useAccounts } from '../context/AccountContext';
import { appointmentsApi, Appointment } from '../lib/api';
import { toast } from 'sonner';
import {
  Calendar, CheckCircle, XCircle, Clock, Trash2, Search, RefreshCw, Phone
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

export default function Agenda() {
  const { activeAccountId } = useAccounts();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

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
    // High-frequency polling (5 seconds) to catch live appointments from leads
    const interval = setInterval(() => {
      loadAppointments(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [activeAccountId]);

  const handleUpdateStatus = async (id: string, newStatus: 'confirmada' | 'cancelada') => {
    try {
      await appointmentsApi.update(id, { status: newStatus });
      toast.success(`Cita ${newStatus === 'confirmada' ? 'confirmada' : 'cancelada'} con éxito`);
      loadAppointments(true);
    } catch (err: any) {
      toast.error('Error al actualizar cita: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar esta cita de la agenda?')) return;
    try {
      await appointmentsApi.delete(id);
      toast.success('Cita eliminada de la agenda');
      loadAppointments(true);
    } catch (err: any) {
      toast.error('Error al eliminar cita: ' + err.message);
    }
  };

  // Filter appointments
  const filteredAppointments = appointments.filter((app) => {
    const matchesSearch =
      app.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (app.resumen && app.resumen.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'todos' || app.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Calendar size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Agenda</h1>
              <p className="text-sm text-slate-500">Administrá las citas y reservas agendadas por tus leads vía WhatsApp</p>
            </div>
          </div>
          <button
            onClick={() => loadAppointments()}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold rounded-xl border border-white/10 transition-all duration-200"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Buscar por nombre, teléfono o descripción..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white/[0.02] border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all placeholder:text-slate-600"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex bg-white/[0.02] border border-white/10 rounded-xl p-1 gap-1">
            {[
              { id: 'todos', label: 'Todos' },
              { id: 'pendiente', label: 'Pendientes' },
              { id: 'confirmada', label: 'Confirmadas' },
              { id: 'cancelada', label: 'Canceladas' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  statusFilter === tab.id
                    ? 'bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Appointments Grid */}
        {loading && appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white/[0.02] border border-white/5 rounded-2xl">
            <RefreshCw className="animate-spin text-teal-400 mb-4" size={32} />
            <p className="text-slate-400 text-sm">Cargando agenda...</p>
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white/[0.02] border border-white/5 rounded-2xl text-center px-4">
            <Calendar className="text-slate-700 mb-4" size={48} />
            <h3 className="text-white font-bold text-base mb-1">No hay citas en la agenda</h3>
            <p className="text-slate-500 text-sm max-w-sm">
              Las citas agendadas por tus clientes a través del nodo "Agendar Cita" aparecerán aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredAppointments.map((app) => (
              <div
                key={app.id}
                className="bg-white/[0.02] backdrop-blur-sm border border-white/10 rounded-2xl p-5 hover:border-white/15 transition-all duration-200 flex flex-col justify-between"
              >
                {/* Upper Card Area */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-white font-bold text-base leading-tight">{app.nombre}</h3>
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs mt-1 font-mono">
                        <Phone size={12} />
                        {app.phone}
                      </div>
                    </div>

                    {/* Status Badge */}
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      app.status === 'confirmada' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      app.status === 'cancelada' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                      'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {app.status}
                    </span>
                  </div>

                  {/* Summary/Description */}
                  {app.resumen && (
                    <div className="bg-black/20 border border-white/5 rounded-xl p-3.5 mb-4">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Resumen del caso</div>
                      <p className="text-xs text-slate-300 leading-relaxed">{app.resumen}</p>
                    </div>
                  )}
                </div>

                {/* Footer and Actions */}
                <div className="border-t border-white/5 pt-4 mt-2">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock size={12} />
                      {formatDistanceToNow(new Date(app.created_at))}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {app.status === 'pendiente' && (
                      <>
                        <button
                          onClick={() => handleUpdateStatus(app.id, 'confirmada')}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 text-xs font-bold py-2 px-3 rounded-lg border border-emerald-500/20 transition-all"
                        >
                          <CheckCircle size={13} />
                          Confirmar
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(app.id, 'cancelada')}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/15 text-red-400 text-xs font-bold py-2 px-3 rounded-lg border border-red-500/20 transition-all"
                        >
                          <XCircle size={13} />
                          Cancelar
                        </button>
                      </>
                    )}
                    
                    {app.status !== 'pendiente' && (
                      <span className="flex-1 text-[11px] text-slate-500 italic py-2">
                        Marcada como {app.status}
                      </span>
                    )}

                    <button
                      onClick={() => handleDelete(app.id)}
                      className="p-2 bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-lg border border-white/5 hover:border-red-500/10 transition-all"
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
    </div>
  );
}
