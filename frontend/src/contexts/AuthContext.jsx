import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const AuthContext = createContext();

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Configure axios to send credentials (cookies) and Authorization header
axios.defaults.withCredentials = true;

// Axios interceptor: add Authorization header from localStorage as fallback for cookie-blocked contexts (Safari iframe, etc)
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Resiliência: repete GETs que falharam por queda momentânea do servidor/edge (Cloudflare 52x, 502/503/504 ou sem resposta)
const RETRY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
axios.interceptors.response.use(undefined, async (error) => {
  const cfg = error?.config;
  const status = error?.response?.status;
  const transient = !error?.response || RETRY_STATUS.has(status);
  const method = (cfg?.method || 'get').toLowerCase();
  if (!cfg || !transient || method !== 'get' || cfg.__retries >= 3) return Promise.reject(error);
  cfg.__retries = (cfg.__retries || 0) + 1;
  await sleep(700 * cfg.__retries);
  return axios(cfg);
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const formatApiErrorDetail = (detail) => {
    if (detail == null) return 'Algo deu errado. Tente novamente.';
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail))
      return detail
        .map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e)))
        .filter(Boolean)
        .join(' ');
    if (detail && typeof detail.msg === 'string') return detail.msg;
    return String(detail);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`, {
        withCredentials: true,
      });
      setUser(data);
    } catch (error) {
      // Clear invalid token
      localStorage.removeItem('access_token');
      setUser(false);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const { data } = await axios.post(
        `${API}/auth/login`,
        { email, password },
        { withCredentials: true }
      );
      // Store token as fallback for cookie-blocked contexts
      if (data.access_token) {
        localStorage.setItem('access_token', data.access_token);
      }
      setUser(data);
      return { success: true };
    } catch (error) {
      const errorMessage =
        formatApiErrorDetail(error.response?.data?.detail) || error.message;
      return { success: false, error: errorMessage };
    }
  };

  const register = async (name, email, password) => {
    try {
      const { data } = await axios.post(
        `${API}/auth/register`,
        { name, email, password },
        { withCredentials: true }
      );
      if (data.access_token) {
        localStorage.setItem('access_token', data.access_token);
      }
      setUser(data);
      return { success: true };
    } catch (error) {
      const errorMessage =
        formatApiErrorDetail(error.response?.data?.detail) || error.message;
      return { success: false, error: errorMessage };
    }
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('access_token');
      setUser(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
