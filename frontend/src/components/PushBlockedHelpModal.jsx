import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Lock, RefreshCw, Chrome, Globe, Apple } from 'lucide-react';

const detectBrowser = () => {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/edg\//.test(ua)) return 'edge';
  if (/chrome|crios/.test(ua) && !/opr|opera/.test(ua)) return 'chrome';
  if (/firefox|fxios/.test(ua)) return 'firefox';
  if (/safari/.test(ua) && !/chrome|crios/.test(ua)) return 'safari';
  return 'other';
};

const BROWSER_STEPS = {
  chrome: {
    label: 'Google Chrome',
    icon: Chrome,
    steps: [
      'Clique no ícone de cadeado 🔒 (ou "Ver informações do site") ao lado da URL.',
      'Localize "Notificações" na lista de permissões.',
      'Altere de "Bloquear" para "Permitir".',
      'Feche a caixa e recarregue esta página (F5 ou Ctrl+R).',
      'Volte ao Dashboard e clique novamente em "Ativar".',
    ],
  },
  edge: {
    label: 'Microsoft Edge',
    icon: Globe,
    steps: [
      'Clique no cadeado 🔒 ao lado da URL.',
      'Selecione "Permissões deste site".',
      'Em "Notificações", troque para "Permitir".',
      'Recarregue a página e clique em "Ativar" novamente.',
    ],
  },
  firefox: {
    label: 'Mozilla Firefox',
    icon: Globe,
    steps: [
      'Clique no cadeado 🔒 ao lado da URL.',
      'Clique em "Mais informações" ou na seta ao lado de "Conexão segura".',
      'Vá em "Permissões" → "Enviar notificações" → desmarque "Usar padrão" e marque "Permitir".',
      'Recarregue a página e clique em "Ativar".',
    ],
  },
  safari: {
    label: 'Safari (macOS / iOS)',
    icon: Apple,
    steps: [
      'No macOS: menu Safari → Ajustes → Sites → Notificações → escolha este site e mude para "Permitir".',
      'No iPhone/iPad: para receber push, você PRECISA adicionar o app à Tela de Início primeiro (compartilhar ↥ → "Adicionar à Tela de Início"), abrir pelo ícone e ativar de novo.',
      'iOS 16.4+ é obrigatório. Versões anteriores não suportam web push.',
      'Recarregue e clique em "Ativar".',
    ],
  },
  other: {
    label: 'Seu navegador',
    icon: Globe,
    steps: [
      'Procure o cadeado 🔒 ou ícone de informação ao lado da URL.',
      'Encontre a opção de "Notificações" nas permissões do site.',
      'Altere para "Permitir".',
      'Recarregue e volte para ativar as notificações.',
    ],
  },
};

export const PushBlockedHelpModal = ({ open, onClose }) => {
  const browser = useMemo(() => detectBrowser(), []);
  const info = BROWSER_STEPS[browser] || BROWSER_STEPS.other;
  const Icon = info.icon;

  if (!open) return null;

  return (
    <div
      data-testid="push-blocked-modal"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel rounded-2xl border border-[#FF003C]/40 max-w-lg w-full p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#FF003C]/15 border border-[#FF003C]/40 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#FF003C]" />
            </div>
            <div>
              <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#FF003C]">Notificações bloqueadas</p>
              <h3 className="font-heading font-black text-lg tracking-tight text-white">Como desbloquear</h3>
            </div>
          </div>
          <button data-testid="push-blocked-close" onClick={onClose} className="text-zinc-500 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2 inline-flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#E0FF00]" />
          <span className="text-xs font-bold text-white">Detectamos: {info.label}</span>
        </div>

        <ol className="space-y-2.5 mb-5">
          {info.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00] font-mono font-bold text-[11px] flex items-center justify-center">
                {i + 1}
              </span>
              <span className="text-sm text-zinc-300 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <div className="rounded-lg bg-[#00F0FF]/5 border border-[#00F0FF]/20 p-3 mb-4 text-[11px] text-zinc-300">
          <b className="text-[#00F0FF]">Por que ativar?</b> Você receberá lembretes D-2 do Anexo IV
          (aviso de novas obras em até 2 dias) direto no dispositivo, mesmo com o navegador
          fechado. Essencial para não perder o prazo com a concessionária.
        </div>

        <div className="flex gap-2">
          <button
            data-testid="push-blocked-reload"
            onClick={() => window.location.reload()}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-sm font-bold py-2 rounded-full"
          >
            <RefreshCw className="w-4 h-4" /> Recarregar página
          </button>
          <button
            data-testid="push-blocked-ok"
            onClick={onClose}
            className="px-5 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-sm font-bold py-2 rounded-full"
          >
            Entendi
          </button>
        </div>
      </motion.div>
    </div>
  );
};
