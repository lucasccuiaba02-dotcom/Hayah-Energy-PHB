import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, User } from 'lucide-react';

export const LoginPage = () => {
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
      navigate('/dashboard');
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div data-testid="login-page" className="min-h-screen flex">
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{
          backgroundImage:
            'url(https://images.unsplash.com/photo-1672872476232-da16b45c9001?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwzfHxjeWJlcnB1bmslMjBhYnN0cmFjdCUyMGJhY2tncm91bmR8ZW58MHx8fHwxNzg0ODI5NjU3fDA&ixlib=rb-4.1.0&q=85)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-[#050505]/80 via-[#050505]/60 to-transparent"></div>
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

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#050505]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
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