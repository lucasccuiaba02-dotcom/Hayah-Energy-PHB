import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, User } from 'lucide-react';

const unsplash = (id) => `https://images.unsplash.com/${id}?w=1800&q=80&auto=format&fit=crop`;

export const HERO_IMAGES = [
  { id: 'photo-1759542877886-39d81e8f2eee', caption: 'Equipe em cesto aéreo · rede de distribuição' },
  { id: 'photo-1597502310092-31cdaa35b46d', caption: 'Eletricista em linha viva · segurança em primeiro lugar' },
  { id: 'photo-1509390373685-579356742d95', caption: 'Manutenção em poste · caminhão-cesto' },
  { id: 'photo-1595856619767-ab739fa7daae', caption: 'Trabalho em altura com EPI completo' },
  { id: 'photo-1563068261-13ebbdf16aa3', caption: 'Rede energizada ao pôr do sol' },
  { id: 'photo-1610028290816-5d937a395a49', caption: 'Postes e cabos · fim de jornada' },
];

const ROTATE_MS = 7000;

const useHeroRotation = () => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    HERO_IMAGES.forEach((img) => {
      const el = new Image();
      el.src = unsplash(img.id);
    });
    const t = setInterval(() => setIndex((i) => (i + 1) % HERO_IMAGES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);
  return [index, setIndex];
};

const HeroBackdrop = ({ index }) => (
  <AnimatePresence initial={false}>
    <motion.div
      key={HERO_IMAGES[index].id}
      data-testid="login-hero-image"
      data-hero-index={index}
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ opacity: { duration: 1.4, ease: 'easeInOut' }, scale: { duration: ROTATE_MS / 1000 + 1.5, ease: 'linear' } }}
      className="absolute inset-0"
      style={{
        backgroundImage: `url(${unsplash(HERO_IMAGES[index].id)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  </AnimatePresence>
);

export const LoginPage = () => {
  const [heroIndex, setHeroIndex] = useHeroRotation();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = isLogin
      ? await login(email, password)
      : await register(name, email, password);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div data-testid="login-page" className="min-h-screen flex">
      <div data-testid="login-hero-panel" className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#050505]">
        <HeroBackdrop index={heroIndex} />
        <div className="absolute inset-0 bg-gradient-to-br from-[#050505]/90 via-[#050505]/60 to-[#050505]/30"></div>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050505] to-transparent"></div>

        <div className="absolute bottom-8 left-12 right-12 z-10 flex items-center justify-between gap-6">
          <AnimatePresence mode="wait">
            <motion.p
              key={HERO_IMAGES[heroIndex].id}
              data-testid="login-hero-caption"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5 }}
              className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-400"
            >
              {HERO_IMAGES[heroIndex].caption}
            </motion.p>
          </AnimatePresence>
          <div className="flex items-center gap-2" data-testid="login-hero-dots">
            {HERO_IMAGES.map((img, i) => (
              <button
                key={img.id}
                type="button"
                aria-label={`Imagem ${i + 1}`}
                data-testid={`login-hero-dot-${i}`}
                onClick={() => setHeroIndex(i)}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === heroIndex ? 'w-8 bg-[#E0FF00]' : 'w-3 bg-white/25 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="relative z-10 flex flex-col justify-center px-12 text-white">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-heading font-black text-6xl tracking-tighter leading-none mb-6"
          >
            <span className="text-white">HAYAH</span>
            <br />
            <span className="text-[#E0FF00]">ENERGY</span>
            <br />
            <span className="text-white text-4xl">Programação</span>
            <br />
            <span className="text-[#00F0FF] text-4xl">de Projetos</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl text-zinc-300 leading-relaxed"
          >
            Excelência operacional em gestão de projetos elétricos.
          </motion.p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 relative flex items-center justify-center p-8 bg-[#050505] overflow-hidden">
        <div className="absolute inset-0 lg:hidden opacity-40" data-testid="login-hero-mobile">
          <HeroBackdrop index={heroIndex} />
          <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/40 via-[#050505]/70 to-[#050505]"></div>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="glass-panel rounded-2xl p-8">
            <div className="mb-8 text-center">
              <h2
                data-testid="auth-title"
                className="font-heading font-black text-3xl tracking-tighter text-white mb-2"
              >
                {isLogin ? 'Entrar' : 'Criar Conta'}
              </h2>
              <p className="text-zinc-400 text-sm">
                {isLogin
                  ? 'Entre para gerenciar seus projetos'
                  : 'Registre-se para começar'}
              </p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                data-testid="auth-error"
                className="mb-6 p-4 bg-[#FF003C]/10 border border-[#FF003C]/30 rounded-lg text-[#FF003C] text-sm"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {!isLogin && (
                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Nome
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                      data-testid="register-name-input"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required={!isLogin}
                      className="w-full bg-zinc-950/90 backdrop-blur-xl border border-white/8 rounded-lg px-12 py-3 text-white placeholder-zinc-600 focus:border-[#00F0FF] focus:outline-none focus:ring-2 focus:ring-[#00F0FF]/20 transition-all"
                      placeholder="Seu nome"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                  <input
                    data-testid="auth-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-zinc-950/90 backdrop-blur-xl border border-white/8 rounded-lg px-12 py-3 text-white placeholder-zinc-600 focus:border-[#00F0FF] focus:outline-none focus:ring-2 focus:ring-[#00F0FF]/20 transition-all"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                  <input
                    data-testid="auth-password-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-zinc-950/90 backdrop-blur-xl border border-white/8 rounded-lg px-12 py-3 text-white placeholder-zinc-600 focus:border-[#00F0FF] focus:outline-none focus:ring-2 focus:ring-[#00F0FF]/20 transition-all"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                data-testid="auth-submit-button"
                type="submit"
                disabled={loading}
                className="w-full bg-[#00F0FF] hover:bg-[#00D8E6] text-black font-bold py-3 rounded-full transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processando...' : isLogin ? 'Entrar' : 'Criar Conta'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                data-testid="auth-toggle-button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                }}
                className="text-sm text-zinc-400 hover:text-[#00F0FF] transition-colors"
              >
                {isLogin ? 'Não tem uma conta? Cadastre-se' : 'Já tem uma conta? Entre'}
              </button>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-zinc-600">
            <p>Credenciais de teste:</p>
            <p className="font-mono">admin@projectmatrix.com / Admin@123</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};