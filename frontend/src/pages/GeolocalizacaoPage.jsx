import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Route, RefreshCw, Navigation, LocateFixed } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { utm21sToLatLng, nearestNeighborRoute, osrmRoute, haversineKm } from '../lib/geo';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Cuiabá central default
const DEFAULT_ORIGIN = { lat: -15.6014, lng: -56.0979, label: 'Cuiabá — Centro' };

const STATUS_COLOR = EXECUTION_STATUS.reduce((acc, s) => ({ ...acc, [s.value]: s.color }), {});

const makeIcon = (color, index) => L.divIcon({
  className: 'geo-pin',
  html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #050505;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
           <span style="transform:rotate(45deg);color:#050505;font-weight:900;font-size:12px;font-family:monospace;">${index}</span>
         </div>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -40],
});

const originIcon = L.divIcon({
  className: 'geo-origin',
  html: `<div style="width:34px;height:34px;border-radius:50%;background:#E0FF00;border:3px solid #050505;box-shadow:0 0 20px rgba(224,255,0,0.7);display:flex;align-items:center;justify-content:center;">
           <span style="color:#050505;font-weight:900;font-size:14px;">★</span>
         </div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const FitBounds = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [points, map]);
  return null;
};

export const GeolocalizacaoPage = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [ordered, setOrdered] = useState([]);
  const [routeGeom, setRouteGeom] = useState(null);
  const [routing, setRouting] = useState(false);
  const [routeMode, setRouteMode] = useState('haversine'); // 'haversine' | 'osrm'
  const [statusFilter, setStatusFilter] = useState('active');
  const mapRef = useRef(null);

  useEffect(() => {
    axios.get(`${API}/geo/projects`)
      .then(({ data }) => setProjects(data))
      .catch(() => toast.error('Erro ao carregar projetos'))
      .finally(() => setLoading(false));
  }, []);

  const points = useMemo(() => {
    return projects
      .map((p) => {
        const coord = utm21sToLatLng(p.utm_x, p.utm_y);
        if (!coord) return null;
        return { ...p, lat: coord.lat, lng: coord.lng };
      })
      .filter(Boolean)
      .filter((p) => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'active') return !['concluido', 'cancelado', 'executada'].includes(p.execution_status);
        return p.execution_status === statusFilter;
      });
  }, [projects, statusFilter]);

  const totalPointsWithUTM = projects.filter((p) => utm21sToLatLng(p.utm_x, p.utm_y)).length;

  const routeInfo = useMemo(() => {
    if (!ordered.length) return null;
    let total = haversineKm(origin, ordered[0]);
    for (let i = 1; i < ordered.length; i++) total += haversineKm(ordered[i - 1], ordered[i]);
    return { distance_km: total, count: ordered.length };
  }, [ordered, origin]);

  const optimizeHaversine = () => {
    if (!points.length) { toast.error('Nenhum projeto com coordenadas'); return; }
    setOrdered(nearestNeighborRoute(origin, points));
    setRouteGeom(null);
    setRouteMode('haversine');
    toast.success(`Rota otimizada: ${points.length} obra(s)`);
  };

  const optimizeOSRM = async () => {
    if (!points.length) { toast.error('Nenhum projeto com coordenadas'); return; }
    setRouting(true);
    try {
      const seq = nearestNeighborRoute(origin, points);
      setOrdered(seq);
      const waypoints = [origin, ...seq];
      const res = await osrmRoute(waypoints);
      if (res) {
        setRouteGeom(res);
        setRouteMode('osrm');
        toast.success(`Rota real: ${res.distance_km.toFixed(1)} km · ${Math.round(res.duration_min)} min`);
      } else {
        setRouteGeom(null);
        setRouteMode('haversine');
        toast.warning('Roteador OSRM indisponível. Mostrando linha reta.');
      }
    } finally {
      setRouting(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocalização não suportada'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Minha localização' });
        toast.success('Origem definida na sua localização atual');
      },
      () => toast.error('Não foi possível obter localização'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const polylinePositions = useMemo(() => {
    if (routeGeom && routeMode === 'osrm') return routeGeom.coordinates;
    if (!ordered.length) return [];
    return [[origin.lat, origin.lng], ...ordered.map((p) => [p.lat, p.lng])];
  }, [routeGeom, routeMode, ordered, origin]);

  return (
    <AppLayout title="Geolocalização" subtitle="Mapa de obras e roteirização otimizada">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
        <div data-testid="geo-stat-total" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Com Coordenadas</p>
          <p className="font-mono text-2xl font-bold text-white">{totalPointsWithUTM}</p>
          <p className="text-[10px] text-zinc-600 mt-1">de {projects.length} projetos com UTM</p>
        </div>
        <div data-testid="geo-stat-plotted" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Plotados</p>
          <p className="font-mono text-2xl font-bold text-[#00F0FF]">{points.length}</p>
          <p className="text-[10px] text-zinc-600 mt-1">após filtro</p>
        </div>
        <div data-testid="geo-stat-distance" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Distância</p>
          <p className="font-mono text-2xl font-bold text-[#E0FF00]">
            {routeGeom && routeMode === 'osrm' ? `${routeGeom.distance_km.toFixed(1)}` : routeInfo ? `${routeInfo.distance_km.toFixed(1)}` : '—'}
            <span className="text-xs text-zinc-500 ml-1">km</span>
          </p>
          <p className="text-[10px] text-zinc-600 mt-1">{routeMode === 'osrm' ? 'rota real' : 'linha reta'}</p>
        </div>
        <div data-testid="geo-stat-duration" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Tempo Estimado</p>
          <p className="font-mono text-2xl font-bold text-[#FF5E00]">
            {routeGeom && routeMode === 'osrm' ? `${Math.round(routeGeom.duration_min)}` : '—'}
            <span className="text-xs text-zinc-500 ml-1">min</span>
          </p>
          <p className="text-[10px] text-zinc-600 mt-1">via OSRM</p>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3">
        <select
          data-testid="geo-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none"
        >
          <option value="active">Apenas ativas</option>
          <option value="all">Todas</option>
          {EXECUTION_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button
          data-testid="geo-use-location"
          onClick={useMyLocation}
          className="flex items-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-bold px-3 py-2 rounded-full transition-all"
        >
          <LocateFixed className="w-3 h-3" /> Usar minha localização
        </button>
        <div className="text-[11px] text-zinc-500 font-mono">
          Origem: {origin.label || `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            data-testid="geo-optimize-simple"
            onClick={optimizeHaversine}
            className="flex items-center gap-2 bg-[#00F0FF]/15 border border-[#00F0FF]/40 hover:bg-[#00F0FF]/25 text-[#00F0FF] text-xs font-bold px-4 py-2 rounded-full transition-all"
          >
            <Route className="w-3 h-3" /> Otimizar (rápido)
          </button>
          <button
            data-testid="geo-optimize-osrm"
            onClick={optimizeOSRM}
            disabled={routing}
            className="flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full transition-all disabled:opacity-60"
          >
            {routing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
            {routing ? 'Traçando rota...' : 'Rota real (OSRM)'}
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        data-testid="geo-map-container"
        className="glass-panel rounded-2xl overflow-hidden mb-4"
        style={{ height: '560px' }}
      >
        {loading ? (
          <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">Carregando mapa...</div>
        ) : (
          <MapContainer
            center={[origin.lat, origin.lng]}
            zoom={11}
            style={{ height: '100%', width: '100%', background: '#050505' }}
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={[origin, ...points]} />
            <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
              <Popup><b>Origem</b><br />{origin.label || 'Ponto de partida'}</Popup>
            </Marker>
            {(ordered.length ? ordered : points).map((p, i) => {
              const idx = ordered.length ? i + 1 : '·';
              const color = STATUS_COLOR[p.execution_status] || '#00F0FF';
              return (
                <Marker key={p.id} position={[p.lat, p.lng]} icon={makeIcon(color, idx)}>
                  <Popup>
                    <div style={{ minWidth: 200 }}>
                      <div style={{ fontSize: 10, color: '#71717a', fontFamily: 'monospace' }}>{p.project_code || '—'}</div>
                      <b style={{ color: '#050505' }}>{p.name}</b>
                      <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>
                        {PROJECT_TYPE_LABEL[p.project_type] || p.project_type}
                        {p.location ? ` · ${p.location}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: '#333' }}>
                        UTM: {p.utm_x} / {p.utm_y}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                        {formatCurrency(p.programmed_value)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            {polylinePositions.length > 0 && (
              <Polyline
                positions={polylinePositions}
                pathOptions={{ color: '#E0FF00', weight: 4, opacity: 0.85, dashArray: routeMode === 'osrm' ? null : '8 6' }}
              />
            )}
          </MapContainer>
        )}
      </motion.div>

      {ordered.length > 0 && (
        <div data-testid="geo-route-list" className="glass-panel rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Ordem de Visita Otimizada</p>
              <h3 className="font-heading font-black text-lg tracking-tighter text-white">{ordered.length} paradas</h3>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00] uppercase">
              {routeMode === 'osrm' ? 'Rota Real' : 'Nearest Neighbor'}
            </span>
          </div>
          <div className="space-y-2">
            {ordered.map((p, i) => (
              <div key={p.id} data-testid={`geo-stop-${i}`} className="flex items-center gap-3 rounded-lg p-3 bg-white/[0.02] border border-white/10">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-mono font-bold text-sm"
                  style={{ background: STATUS_COLOR[p.execution_status] + '22', border: `1px solid ${STATUS_COLOR[p.execution_status]}`, color: STATUS_COLOR[p.execution_status] }}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">{p.project_code ? `${p.project_code} · ` : ''}{p.name}</p>
                  <p className="text-[11px] text-zinc-500">
                    {PROJECT_TYPE_LABEL[p.project_type] || p.project_type}
                    {p.location ? ` · ${p.location}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-sm text-[#39FF14]">{formatCurrency(p.programmed_value)}</p>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-[#00F0FF] hover:underline"
                  >
                    Abrir no Maps ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
};
