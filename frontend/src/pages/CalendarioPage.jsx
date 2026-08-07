import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { AppLayout } from '../components/AppLayout';
import { HScroller } from '../components/HScroller';
import { ChevronLeft, ChevronRight, Zap, AlertTriangle, CalendarDays } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const getStatusColor = (status) => {
  // Verde = concluído, Amarelo = programado, Ciano = em execução, Cinza = aguardando, Vermelho = cancelado
  const map = {
    concluido: { bg: '#39FF14', text: '#050505' },
    em_execucao: { bg: '#00F0FF', text: '#050505' },
    programado: { bg: '#E0FF00', text: '#050505' },
    aguardando_inicio: { bg: '#94A3B8', text: '#050505' },
    cancelado: { bg: '#FF003C', text: '#fff' },
  };
  return map[status] || map.programado;
};

const formatCellDate = (isoDate) => {
  const d = new Date(isoDate + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}/${MONTH_ABBR[d.getMonth()]} - ${WEEKDAY_ABBR[d.getDay()]}`;
};

const addDays = (isoDate, days) => {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const CalendarioPage = () => {
  const [data, setData] = useState(null);
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  });

  const loadCalendar = async (start) => {
    const end = addDays(start, 13);
    const { data } = await axios.get(`${API}/schedule/calendar?start_date=${start}&end_date=${end}`);
    setData(data);
  };

  useEffect(() => {
    loadCalendar(startDate);
  }, [startDate]);

  const goPrev = () => setStartDate(addDays(startDate, -14));
  const goNext = () => setStartDate(addDays(startDate, 14));
  const goToday = () => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    setStartDate(monday.toISOString().slice(0, 10));
  };

  return (
    <AppLayout
      title="Calendário por Equipe"
      subtitle="Matriz de programação — cores por status"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2 py-1">
            <CalendarDays className="w-3.5 h-3.5 text-[#00F0FF]" />
            <input
              data-testid="cal-jump-date"
              type="date"
              value={startDate}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
              className="bg-transparent border-none text-xs text-white font-mono focus:outline-none"
              title="Ir para essa data"
            />
          </div>
          <button
            data-testid="cal-prev"
            onClick={goPrev}
            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            data-testid="cal-today"
            onClick={goToday}
            className="px-4 py-2 rounded-full text-sm font-bold bg-[#E0FF00] text-black hover:bg-[#C8E600] transition-all"
          >
            Hoje
          </button>
          <button
            data-testid="cal-next"
            onClick={goNext}
            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      }
    >
      <div className="glass-panel rounded-xl p-3 mb-4 flex items-center gap-4 flex-wrap text-xs">
        <p className="text-zinc-500 tracking-[0.2em] uppercase font-bold">Legenda:</p>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#39FF14' }}></span> Concluído</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#00F0FF' }}></span> Em Execução</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#E0FF00' }}></span> Programado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#94A3B8' }}></span> Aguardando</span>
        <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-[#FF5E00]" /> Linha Viva</span>
        <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-[#E0FF00]" /> Desligamento</span>
      </div>

      {data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          data-testid="calendar-grid"
          className="glass-panel rounded-2xl overflow-hidden"
        >
          <HScroller step={400} testid="calendario-hscroll">
            <table className="w-full border-collapse min-w-max">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500 sticky left-0 bg-[#09090b] z-10 min-w-[140px]">
                    CALENDÁRIO P/ EQUIPE
                  </th>
                  {data.dates.map((d) => {
                    const dateObj = new Date(d + 'T00:00:00');
                    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                    return (
                      <th
                        key={d}
                        data-testid={`cal-header-${d}`}
                        className="px-2 py-3 text-xs font-bold border-l border-white/5 min-w-[100px]"
                        style={{ color: isWeekend ? '#71717a' : '#a1a1aa' }}
                      >
                        {formatCellDate(d)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.teams.map((team) => {
                  const teamKey = team.id || 'unassigned';
                  const row = data.grid[teamKey] || {};
                  const hasAny = Object.values(row).some((cell) => cell.length > 0);
                  if (!hasAny && teamKey === 'unassigned') return null;
                  return (
                    <tr key={teamKey} className="border-b border-white/5" data-testid={`cal-row-${teamKey}`}>
                      <td className="px-4 py-2 sticky left-0 bg-[#09090b] z-10 border-r border-white/5">
                        <p className="text-white font-bold text-sm">{team.name}</p>
                        {team.supervisor && (
                          <p className="text-[10px] text-[#E0FF00] mt-0.5">{team.supervisor}</p>
                        )}
                      </td>
                      {data.dates.map((d) => {
                        const cell = row[d] || [];
                        return (
                          <td key={d} className="border-l border-white/5 p-1 align-top" style={{ minWidth: '100px' }}>
                            <div className="flex flex-col gap-1">
                              {cell.map((p) => {
                                const c = getStatusColor(p.execution_status);
                                const hasShutdownToday = Array.isArray(p.shutdown_dates)
                                  ? p.shutdown_dates.includes(d)
                                  : !!p.shutdown_info; // legacy fallback
                                return (
                                  <div
                                    key={p.id}
                                    data-testid={`cal-cell-${teamKey}-${d}-${p.id}`}
                                    title={`${p.name}${p.location ? ' — ' + p.location : ''}${hasShutdownToday ? ' · com desligamento neste dia' : ''}`}
                                    className="px-2 py-1 rounded font-mono text-xs font-bold flex items-center gap-1 leading-tight"
                                    style={{ backgroundColor: c.bg, color: c.text }}
                                  >
                                    <span className="flex-1 truncate">{p.code}</span>
                                    {p.requires_hot_line && <Zap className="w-3 h-3 flex-shrink-0" style={{ color: '#8B0000' }} />}
                                    {hasShutdownToday && <AlertTriangle data-testid={`cal-shutdown-${teamKey}-${d}-${p.id}`} className="w-3 h-3 flex-shrink-0" style={{ color: '#7F5A00' }} />}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HScroller>
        </motion.div>
      )}
    </AppLayout>
  );
};
