import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { formatCurrency, PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, MATERIAL_STATUS_LABEL } from '../lib/constants';
import { MapPin, Zap, AlertTriangle, CheckCircle2, Clock, Package, Users, QrCode, ExternalLink } from 'lucide-react';
import { syncQueue } from '../lib/offline';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const OperacionalPage = () => {
  const [data, setData] = useState(null);
  const [checklists, setChecklists] = useState({});
  const [qrProject, setQrProject] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/operacional/today`).then(({ data }) => setData(data));
    try {
      const saved = JSON.parse(localStorage.getItem('operacional_checklists') || '{}');
      setChecklists(saved);
    } catch { /* noop */ }
    // Sync offline queue on mount
    if (navigator.onLine) {
      syncQueue(axios, API).then((r) => {
        if (r.synced > 0) toast.success(`${r.synced} atualização(ões) offline sincronizada(s)`);
      });
    }
  }, []);

  const toggleCheck = (projectId, key) => {
    const updated = {
      ...checklists,
      [projectId]: {
        ...(checklists[projectId] || {}),
        [key]: !(checklists[projectId] || {})[key],
      },
    };
    setChecklists(updated);
    localStorage.setItem('operacional_checklists', JSON.stringify(updated));
  };

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <AppLayout title="Operacional" subtitle={`Obras de hoje — ${today}`}>
      {data && (
        <>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 gap-3 mb-6"
          >
            <div data-testid="op-stat-projects" className="glass-panel rounded-2xl p-5 text-center">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Obras Hoje</p>
              <p className="font-mono text-4xl font-black text-[#E0FF00]">{data.total_projects}</p>
            </div>
            <div data-testid="op-stat-value" className="glass-panel rounded-2xl p-5 text-center">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Valor Total</p>
              <p className="font-mono text-lg font-bold text-white break-all">{formatCurrency(data.total_value)}</p>
            </div>
            <div data-testid="op-stat-hotline" className="glass-panel rounded-2xl p-5 text-center">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Linha Viva</p>
              <p className="font-mono text-4xl font-black text-[#FF5E00]">{data.hot_line_count}</p>
            </div>
          </motion.div>

          {Object.keys(data.by_team).length === 0 ? (
            <div className="glass-panel rounded-2xl p-12 text-center">
              <Clock className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-400 text-lg">Nenhuma obra programada para hoje.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(data.by_team).map(([teamName, projects]) => (
                <motion.div
                  key={teamName}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  data-testid={`op-team-${teamName.replace(/\s+/g, '_')}`}
                  className="glass-panel rounded-2xl overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#E0FF00]" />
                    <p className="font-heading font-black text-white">{teamName}</p>
                    <span className="text-xs text-zinc-500 ml-auto">{projects.length} obra{projects.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {projects.map((p, i) => {
                      const execStatus = EXECUTION_STATUS_LABEL[p.execution_status];
                      const matStatus = MATERIAL_STATUS_LABEL[p.material_status];
                      const cl = checklists[p.id] || {};
                      return (
                        <div key={p.id} data-testid={`op-project-${i}`} className="p-4">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1">
                              {p.project_code && (
                                <p className="font-mono text-xs text-[#E0FF00] mb-1">{p.project_code}</p>
                              )}
                              <h3 className="text-white font-bold text-base">{p.name}</h3>
                              <p className="text-xs text-zinc-500 mt-1">{PROJECT_TYPE_LABEL[p.project_type]}</p>
                              {p.location && (
                                <p className="text-xs text-zinc-300 mt-2 flex items-start gap-1">
                                  <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-zinc-500" />
                                  {p.location}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2 flex-shrink-0">
                              <span
                                className="px-2 py-1 rounded-full text-[10px] font-bold border"
                                style={{
                                  backgroundColor: `${execStatus?.color}15`,
                                  borderColor: `${execStatus?.color}40`,
                                  color: execStatus?.color,
                                }}
                              >
                                {execStatus?.label}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  data-testid={`op-qr-${p.id}`}
                                  onClick={() => setQrProject(p)}
                                  className="w-8 h-8 rounded-lg bg-[#E0FF00]/10 border border-[#E0FF00]/40 flex items-center justify-center text-[#E0FF00]"
                                  title="QR Code"
                                >
                                  <QrCode className="w-4 h-4" />
                                </button>
                                <button
                                  data-testid={`op-open-${p.id}`}
                                  onClick={() => navigate(`/projeto/${p.id}`)}
                                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
                                  title="Abrir"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Checklist */}
                          <div className="space-y-2 mt-4 border-t border-white/5 pt-3">
                            {p.requires_hot_line && (
                              <label className="flex items-center gap-3 p-2 rounded-lg bg-[#FF5E00]/10 border border-[#FF5E00]/30 cursor-pointer">
                                <input
                                  data-testid={`op-check-hotline-${p.id}`}
                                  type="checkbox"
                                  checked={cl.hotline || false}
                                  onChange={() => toggleCheck(p.id, 'hotline')}
                                  className="w-5 h-5 accent-[#FF5E00] flex-shrink-0"
                                />
                                <Zap className="w-4 h-4 text-[#FF5E00] flex-shrink-0" />
                                <div className="flex-1">
                                  <p className="text-sm font-bold text-[#FF5E00]">Linha Viva — EPI Completo?</p>
                                  <p className="text-xs text-zinc-400">Confirmar equipamentos de proteção</p>
                                </div>
                              </label>
                            )}
                            {p.shutdown_info && (
                              <label className="flex items-center gap-3 p-2 rounded-lg bg-[#E0FF00]/10 border border-[#E0FF00]/30 cursor-pointer">
                                <input
                                  data-testid={`op-check-shutdown-${p.id}`}
                                  type="checkbox"
                                  checked={cl.shutdown || false}
                                  onChange={() => toggleCheck(p.id, 'shutdown')}
                                  className="w-5 h-5 accent-[#E0FF00] flex-shrink-0"
                                />
                                <AlertTriangle className="w-4 h-4 text-[#E0FF00] flex-shrink-0" />
                                <div className="flex-1">
                                  <p className="text-sm font-bold text-[#E0FF00]">Desligamento Confirmado?</p>
                                  <p className="text-xs text-zinc-400">"{p.shutdown_info}"</p>
                                </div>
                              </label>
                            )}
                            <label className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/10 cursor-pointer">
                              <input
                                data-testid={`op-check-material-${p.id}`}
                                type="checkbox"
                                checked={cl.material || false}
                                onChange={() => toggleCheck(p.id, 'material')}
                                className="w-5 h-5 accent-[#39FF14] flex-shrink-0"
                              />
                              <Package className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                              <div className="flex-1">
                                <p className="text-sm font-bold text-white">Material Separado?</p>
                                <p className="text-xs" style={{ color: matStatus?.color }}>
                                  Status: {matStatus?.label}
                                </p>
                              </div>
                            </label>
                            <label className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/10 cursor-pointer">
                              <input
                                data-testid={`op-check-team-${p.id}`}
                                type="checkbox"
                                checked={cl.team || false}
                                onChange={() => toggleCheck(p.id, 'team')}
                                className="w-5 h-5 accent-[#39FF14] flex-shrink-0"
                              />
                              <CheckCircle2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                              <div className="flex-1">
                                <p className="text-sm font-bold text-white">Equipe no Local?</p>
                              </div>
                            </label>
                          </div>

                          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Programado</p>
                            <p className="font-mono text-sm font-bold text-white">{formatCurrency(p.programmed_value)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {qrProject && (
        <div
          onClick={() => setQrProject(null)}
          data-testid="qr-modal"
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-sm w-full text-center"
          >
            <p className="font-mono text-xs text-zinc-500 mb-1">{qrProject.project_code}</p>
            <h3 className="font-heading font-black text-lg text-black tracking-tighter mb-4">{qrProject.name}</h3>
            <div className="flex justify-center mb-4">
              <QRCodeSVG
                value={`${window.location.origin}/projeto/${qrProject.id}`}
                size={220}
                level="H"
                includeMargin
                imageSettings={{
                  src: '/favicon.ico',
                  height: 30,
                  width: 30,
                  excavate: true,
                }}
              />
            </div>
            <p className="text-xs text-zinc-500 mb-4">Escaneie no celular para abrir o checklist da obra</p>
            <button
              data-testid="qr-close"
              onClick={() => setQrProject(null)}
              className="w-full bg-black text-white font-bold py-3 rounded-full"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </AppLayout>
  );
};
