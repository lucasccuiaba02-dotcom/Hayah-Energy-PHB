import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader, Clock } from 'lucide-react';
import { HayahLogo } from '../components/HayahLogo';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/** Out/2026 · Retorno do Stripe Checkout — faz polling do status até confirmar o pagamento (máx. ~10 s). */
export const PaymentReturnPage = () => {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const cancelled = pathname.endsWith('/cancel');
  const [state, setState] = useState(cancelled ? 'cancel' : 'checking');
  const tries = useRef(0);

  useEffect(() => {
    if (cancelled || !sessionId) { if (!cancelled) setState('error'); return undefined; }
    let alive = true;
    const poll = async () => {
      tries.current += 1;
      try {
        const { data } = await axios.get(`${API}/licenca/pagamento/status/${sessionId}`);
        if (!alive) return;
        if (data.payment_status === 'paid') { setState('paid'); return; }
        if (data.status === 'expired' || data.payment_status === 'failed') { setState('error'); return; }
      } catch { /* continua tentando */ }
      if (tries.current < 6 && alive) setTimeout(poll, 2000); else if (alive) setState('timeout');
    };
    poll();
    return () => { alive = false; };
  }, [sessionId, cancelled]);

  const views = {
    checking: { icon: <Loader className="w-10 h-10 animate-spin text-[#E0FF00]" />, title: 'Confirmando pagamento…', text: 'Aguarde alguns segundos enquanto confirmamos com a operadora.' },
    paid: { icon: <CheckCircle2 className="w-10 h-10 text-[#39FF14]" />, title: 'Pagamento confirmado!', text: 'A licença foi renovada e o acesso está liberado.' },
    cancel: { icon: <XCircle className="w-10 h-10 text-[#FF5E00]" />, title: 'Pagamento cancelado', text: 'Nenhuma cobrança foi feita. Você pode tentar novamente quando quiser.' },
    timeout: { icon: <Clock className="w-10 h-10 text-[#FF5E00]" />, title: 'Ainda processando', text: 'O pagamento ainda não foi confirmado. Se já pagou, aguarde um minuto e abra a página da licença — a renovação é automática.' },
    error: { icon: <XCircle className="w-10 h-10 text-[#FF003C]" />, title: 'Não foi possível confirmar', text: 'Verifique o status na página da licença ou tente novamente.' },
  };
  const v = views[state];
  return (
    <div data-testid="payment-return" className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full glass-panel rounded-2xl p-8 text-center space-y-4">
        <div className="flex justify-center"><HayahLogo size="md" showText /></div>
        <div className="flex justify-center">{v.icon}</div>
        <h1 className="text-2xl font-heading font-black tracking-tighter" data-testid="payment-return-title">{v.title}</h1>
        <p className="text-sm text-zinc-400">{v.text}</p>
        <Link to="/licenca" data-testid="payment-return-link" className="inline-block px-5 py-2.5 rounded-full bg-[#E0FF00] text-black text-xs font-black">Ir para a licença</Link>
      </div>
    </div>
  );
};

export default PaymentReturnPage;
