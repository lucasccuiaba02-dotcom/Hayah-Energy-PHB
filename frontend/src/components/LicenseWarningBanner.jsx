import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useLicense, dateBR } from '../lib/license';

/** Out/2026 · Faixa de aviso: licença vence em ≤ 5 dias. */
export const LicenseWarningBanner = () => {
  const lic = useLicense();
  const navigate = useNavigate();
  if (!lic?.enabled || !lic?.warning || lic?.blocked) return null;
  const when = lic.days_left === 0 ? 'HOJE' : `em ${lic.days_left} dia(s)`;
  return (
    <div data-testid="license-warning-banner" className="mx-4 md:mx-8 mt-4 rounded-xl border border-[#FF5E00]/50 bg-[#FF5E00]/10 px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <AlertTriangle className="w-4 h-4 text-[#FF5E00] flex-shrink-0" />
      <p className="flex-1 min-w-0 text-xs text-white">
        <span className="font-bold">Licença de uso vence {when}</span> ({dateBR(lic.paid_until)}). Renove para evitar o bloqueio do sistema para todos os usuários.
      </p>
      <button type="button" data-testid="license-warning-renew" onClick={() => navigate('/licenca')} className="px-3 py-1.5 rounded-full bg-[#FF5E00] text-black text-[11px] font-black hover:bg-[#ff7a2a] transition-colors">
        Renovar
      </button>
    </div>
  );
};
