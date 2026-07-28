import React from 'react';
import { motion } from 'framer-motion';
import { X, Calendar as CalendarIcon, Users, DollarSign } from 'lucide-react';

export const ProjectFilters = ({ filters, onChange, teams, onReset, showValueFilter = false }) => {
  const hasFilters = filters.startDate || filters.endDate || filters.teamId || filters.minValue || filters.maxValue;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="project-filters"
      className="glass-panel rounded-2xl p-4 mb-6"
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500">Filtros:</span>
        </div>

        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-zinc-500" />
          <input
            data-testid="filter-start-date"
            type="date"
            value={filters.startDate || ''}
            onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none font-mono"
            placeholder="Data Início"
          />
          <span className="text-zinc-600">→</span>
          <input
            data-testid="filter-end-date"
            type="date"
            value={filters.endDate || ''}
            onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none font-mono"
            placeholder="Data Fim"
          />
        </div>

        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-500" />
          <select
            data-testid="filter-team"
            value={filters.teamId || ''}
            onChange={(e) => onChange({ ...filters, teamId: e.target.value })}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none"
          >
            <option value="">Todas as equipes</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {showValueFilter && (
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-zinc-500" />
            <input
              data-testid="filter-min-value"
              type="number"
              placeholder="Prog. mín"
              value={filters.minValue || ''}
              onChange={(e) => onChange({ ...filters, minValue: e.target.value })}
              className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-28 focus:border-[#39FF14] focus:outline-none font-mono"
            />
            <span className="text-zinc-600">→</span>
            <input
              data-testid="filter-max-value"
              type="number"
              placeholder="Prog. máx"
              value={filters.maxValue || ''}
              onChange={(e) => onChange({ ...filters, maxValue: e.target.value })}
              className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-28 focus:border-[#39FF14] focus:outline-none font-mono"
            />
          </div>
        )}

        {hasFilters && (
          <button
            data-testid="reset-filters"
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-[#FF003C] hover:text-[#FF3060] transition-colors ml-auto"
          >
            <X className="w-3 h-3" />
            Limpar Filtros
          </button>
        )}
      </div>
    </motion.div>
  );
};
