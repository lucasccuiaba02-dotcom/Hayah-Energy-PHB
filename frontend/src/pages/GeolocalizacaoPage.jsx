import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Route, RefreshCw, Navigation, LocateFixed, FileDown, Share2, Users, Radio, RadioTower } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { utm21sToLatLng, nearestNeighborRoute, osrmRoute, haversineKm } from '../lib/geo';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DEFAULT_ORIGIN = { lat: -15.6014, lng: -56.0979, label: 'Cuiabá — Centro' };
const STATUS_COLOR = EXECUTION_STATUS.reduce((acc, s) => ({ ...acc, [s.value]: s.color }), {});
const TEAM_COLORS = ['#E0FF00', '#00F0FF', '#FF5E00', '#39FF14', '#A855F7', '#EC4899', '#22D3EE', '#F59E0B', '#6366F1', '#10B981'];

const makeIcon = (color, label) => L.divIcon({
  className: 'geo-pin',
  html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #050505;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
           <span style="transform:rotate(45deg);color:#050505;font-weight:900;font-size:11px;font-family:monospace;">${label}</span>
         </div>`,
  iconSize: [32, 42], iconAnchor: [16, 42], popupAnchor: [0, -40],
});

const originIcon = L.divIcon({
  className: 'geo-origin',
  html: `<div style="width:34px;height:34px;border-radius:50%;background:#E0FF00;border:3px solid #050505;box-shadow:0 0 20px rgba(224,255,0,0.7);display:flex;align-items:center;justify-content:center;">
           <span style="color:#050505;font-weight:900;font-size:14px;">★</span>
         </div>`,
  iconSize: [34, 34], iconAnchor: [17, 17],
});

const liveIcon = (color) => L.divIcon({
  className: 'geo-live',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #050505;box-shadow:0 0 0 6px ${color}33, 0 0 0 12px ${color}18;animation:hayah-live-pulse 1.6s infinite;"></div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
});

const hoverHighlightIcon = () => L.divIcon({
  className: 'geo-hover',
  html: `<div style="width:60px;height:60px;border-radius:50%;background:rgba(224,255,0,0.15);border:3px dashed #E0FF00;box-shadow:0 0 30px rgba(224,255,0,0.6);animation:hayah-hover-spin 3s linear infinite;"></div>`,
  iconSize: [60, 60], iconAnchor: [30, 30],
});

const FitBounds = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
  }, [points, map]);
  return null;
};

const FlyTo = ({ target }) => {
  const map = useMap();
  useEffect(() => {
    if (target && Number.isFinite(target.lat) && Number.isFinite(target.lng)) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
    }
  }, [target, map]);
  return null;
};

export const GeolocalizacaoPage = () => {
  const [projects, setProjects] = useState([]);
  const [teamsList, setTeamsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [statusFilter, setStatusFilter] = useState('active');
  const [teamFilter, setTeamFilter] = useState(''); // '' = todas, id = specific team
  const [teamRoutes, setTeamRoutes] = useState({}); // { teamId: { stops:[], geom, mode, distance_km, duration_min } }
  const [routing, setRouting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hoveredStop, setHoveredStop] = useState(null);
  const [liveList, setLiveList] = useState([]);
  const [sharing, setSharing] = useState(false);
  const watchIdRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    Promise.allSettled([
      axios.get(`${API}/geo/projects`),
      axios.get(`${API}/teams`),
    ]).then(([g, t]) => {
      if (g.status === 'fulfilled') setProjects(g.value.data);
      if (t.status === 'fulfilled') setTeamsList(t.value.data);
      setLoading(false);
    });
  }, []);

  // Live tracking: poll positions every 8s
  useEffect(() => {
    let cancel = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`${API}/tracking/live`);
        if (!cancel) setLiveList(data || []);
      } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 8000);
    return () => { cancel = true; clearInterval(iv); };
  }, []);

  // Share my position while sharing=true
  useEffect(() => {
    if (!sharing) {
      if (watchIdRef.current) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      return;
    }
    if (!navigator.geolocation) { toast.error('Geolocalização indisponível'); setSharing(false); return; }
    const send = async (pos) => {
      try {
        await axios.post(`${API}/tracking/ping`, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        });
      } catch { /* ignore */ }
    };
    watchIdRef.current = navigator.geolocation.watchPosition(
      send,
      (err) => { console.warn('watch err', err); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      if (watchIdRef.current) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    };
  }, [sharing]);

  const toggleSharing = async () => {
    if (sharing) {
      try { await axios.delete(`${API}/tracking/ping`); } catch {}
      setSharing(false);
      toast.info('Compartilhamento de localização parado');
    } else {
      setSharing(true);
      toast.success('Compartilhando localização ao vivo!');
    }
  };

  const teamName = (id) => teamsList.find((t) => t.id === id)?.name || 'Sem equipe';

  const points = useMemo(() => {
    return projects
      .map((p) => {
        const c = utm21sToLatLng(p.utm_x, p.utm_y);
        if (!c) return null;
        return { ...p, lat: c.lat, lng: c.lng };
      })
      .filter(Boolean)
      .filter((p) => {
        if (statusFilter === 'active') { if (['concluido', 'cancelado', 'executada'].includes(p.execution_status)) return false; }
        else if (statusFilter !== 'all') { if (p.execution_status !== statusFilter) return false; }
        if (teamFilter && (p.team_id || 'unassigned') !== teamFilter) return false;
        return true;
      });
  }, [projects, statusFilter, teamFilter]);

  const groupedByTeam = useMemo(() => {
    const g = {};
    points.forEach((p) => {
      const k = p.team_id || 'unassigned';
      if (!g[k]) g[k] = [];
      g[k].push(p);
    });
    return g;
  }, [points]);

  const optimizeAll = async (useOsrm) => {
    if (!points.length) { toast.error('Nenhum projeto com coordenadas nesse filtro'); return; }
    setRouting(true);
    const next = {};
    let idx = 0;
    try {
      for (const [tid, pts] of Object.entries(groupedByTeam)) {
        const ordered = nearestNeighborRoute(origin, pts);
        let geom = null, distance = null, duration = null, mode = 'haversine';
        if (useOsrm) {
          const r = await osrmRoute([origin, ...ordered]);
          if (r) { geom = r.coordinates; distance = r.distance_km; duration = r.duration_min; mode = 'osrm'; }
        }
        if (!geom) {
          let d = haversineKm(origin, ordered[0]);
          for (let i = 1; i < ordered.length; i++) d += haversineKm(ordered[i - 1], ordered[i]);
          distance = d;
        }
        next[tid] = { stops: ordered, geom, distance_km: distance, duration_min: duration, mode, color: TEAM_COLORS[idx % TEAM_COLORS.length] };
        idx++;
      }
      setTeamRoutes(next);
      const teamCount = Object.keys(next).length;
      toast.success(`${teamCount} rota${teamCount > 1 ? 's' : ''} otimizada${teamCount > 1 ? 's' : ''}${useOsrm ? ' (OSRM)' : ''}`);
    } finally { setRouting(false); }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocalização não suportada'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Minha localização' }); toast.success('Origem atualizada'); },
      () => toast.error('Não foi possível obter localização'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const teamRoutesList = Object.entries(teamRoutes);
  const totalDistance = teamRoutesList.reduce((s, [, r]) => s + (r.distance_km || 0), 0);
  const totalDuration = teamRoutesList.reduce((s, [, r]) => s + (r.duration_min || 0), 0);

  const exportPdf = async (teamId) => {
    const route = teamRoutes[teamId];
    if (!route) { toast.error('Otimize primeiro'); return; }
    setExporting(true);
    try {
      const payload = {
        team_name: teamId === 'unassigned' ? 'Sem equipe' : teamName(teamId),
        origin: { label: origin.label, lat: origin.lat, lng: origin.lng },
        distance_km: route.distance_km || 0,
        duration_min: route.duration_min || 0,
        route_mode: route.mode || 'haversine',
        stops: route.stops.map((s, i) => ({
          order: i + 1,
          project_code: s.project_code || '',
          name: s.name || '',
          project_type: s.project_type || '',
          location: s.location || '',
          programmed_value: s.programmed_value || 0,
          lat: s.lat, lng: s.lng,
          execution_status: s.execution_status || '',
        })),
      };
      const { data } = await axios.post(`${API}/geo/route-pdf`, payload, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `roteiro_${(teamId === 'unassigned' ? 'sem-equipe' : teamName(teamId)).toLowerCase().replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Roteiro em PDF pronto!');
    } catch { toast.error('Erro ao gerar PDF'); }
    finally { setExporting(false); }
  };

  const shareWhatsApp = (teamId) => {
    const route = teamRoutes[teamId];
    if (!route) { toast.error('Otimize primeiro'); return; }
    const name = teamId === 'unassigned' ? 'Sem equipe' : teamName(teamId);
    let msg = `*HAYAH ENERGY — Roteiro de ${name}*\n`;
    msg += `Origem: ${origin.label}\n`;
    msg += `Distância: ${route.distance_km?.toFixed(1) || '?'} km`;
    if (route.duration_min) msg += ` · ${Math.round(route.duration_min)} min`;
    msg += `\n\n`;
    route.stops.forEach((s, i) => {
      msg += `${i + 1}. ${s.project_code || ''} ${s.name}\n`;
      if (s.location) msg += `   ${s.location}\n`;
      msg += `   https://maps.google.com/?q=${s.lat},${s.lng}\n\n`;
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const allPolylines = teamRoutesList.map(([tid, r]) => ({
    key: tid,
    color: r.color,
    positions: r.geom || [[origin.lat, origin.lng], ...r.stops.map((s) => [s.lat, s.lng])],
    dash: r.mode === 'osrm' ? null : '8 6',
  }));

  return (
    <AppLayout title="Geolocalização" subtitle="Mapa de obras e roteirização otimizada por equipe">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div data-testid="geo-stat-plotted" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Obras no mapa</p>
          <p className="font-mono text-2xl font-bold text-[#00F0FF]">{points.length}</p>
        </div>
        <div data-testid="geo-stat-teams" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Equipes em rota</p>
          <p className="font-mono text-2xl font-bold text-[#E0FF00]">{teamRoutesList.length}</p>
        </div>
        <div data-testid="geo-stat-distance" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Distância total</p>
          <p className="font-mono text-2xl font-bold text-[#39FF14]">{totalDistance ? totalDistance.toFixed(1) : '—'} <span className="text-xs text-zinc-500">km</span></p>
        </div>
        <div data-testid="geo-stat-duration" className="glass-panel rounded-xl p-4">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Tempo total</p>
          <p className="font-mono text-2xl font-bold text-[#FF5E00]">{totalDuration ? Math.round(totalDuration) : '—'} <span className="text-xs text-zinc-500">min</span></p>
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
          <option value="all">Todos os status</option>
          {EXECUTION_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-500" />
          <select
            data-testid="geo-team-filter"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none"
          >
            <option value="">Todas as equipes</option>
            {teamsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="unassigned">Sem equipe</option>
          </select>
        </div>

        <button
          data-testid="geo-use-location"
          onClick={useMyLocation}
          className="flex items-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-bold px-3 py-2 rounded-full transition-all"
        >
          <LocateFixed className="w-3 h-3" /> Minha localização
        </button>

        <div className="text-[11px] text-zinc-500 font-mono">Origem: {origin.label || `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`}</div>

        <div className="ml-auto flex gap-2 flex-wrap">
          <button
            data-testid="geo-toggle-sharing"
            onClick={toggleSharing}
            className={`flex items-center gap-2 border text-xs font-bold px-4 py-2 rounded-full transition-all ${sharing ? 'bg-[#FF003C]/15 border-[#FF003C] text-[#FF003C]' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}
          >
            {sharing ? <RadioTower className="w-3 h-3 animate-pulse" /> : <Radio className="w-3 h-3" />}
            {sharing ? 'Parar rastreio' : 'Compartilhar minha localização'}
          </button>
          <button
            data-testid="geo-optimize-simple"
            onClick={() => optimizeAll(false)}
            disabled={routing}
            className="flex items-center gap-2 bg-[#00F0FF]/15 border border-[#00F0FF]/40 hover:bg-[#00F0FF]/25 text-[#00F0FF] text-xs font-bold px-4 py-2 rounded-full transition-all disabled:opacity-60"
          >
            <Route className="w-3 h-3" /> Otimizar por equipe
          </button>
          <button
            data-testid="geo-optimize-osrm"
            onClick={() => optimizeAll(true)}
            disabled={routing}
            className="flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full transition-all disabled:opacity-60"
          >
            {routing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
            {routing ? 'Traçando...' : 'Rota real (OSRM)'}
          </button>
        </div>
      </div>

      {liveList.length > 0 && (
        <div data-testid="geo-live-bar" className="glass-panel rounded-xl px-4 py-2 mb-4 flex items-center gap-2 border-l-4 border-[#FF003C]">
          <RadioTower className="w-4 h-4 text-[#FF003C] animate-pulse" />
          <span className="text-xs font-bold text-white">Rastreio ao vivo:</span>
          <span className="text-[11px] text-zinc-400">{liveList.length} equipe(s) online</span>
          <div className="flex gap-2 ml-2">
            {liveList.slice(0, 6).map((l) => (
              <span key={l.user_id} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-300">
                {l.user_name?.split(' ')[0] || l.user_email?.split('@')[0]}
              </span>
            ))}
            {liveList.length > 6 && <span className="text-[10px] text-zinc-500">+{liveList.length - 6}</span>}
          </div>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        data-testid="geo-map-container"
        className="glass-panel rounded-2xl overflow-hidden mb-4"
        style={{ height: '580px' }}
      >
        {loading ? (
          <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">Carregando mapa...</div>
        ) : (
          <MapContainer center={[origin.lat, origin.lng]} zoom={11} style={{ height: '100%', width: '100%', background: '#050505' }} ref={mapRef}>
            <TileLayer
              attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={[origin, ...points]} />
            <FlyTo target={hoveredStop} />
            <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
              <Popup><b>Origem</b><br />{origin.label || 'Ponto de partida'}</Popup>
            </Marker>
            {hoveredStop && (
              <Marker position={[hoveredStop.lat, hoveredStop.lng]} icon={hoverHighlightIcon()} interactive={false} />
            )}
            {liveList.map((l, i) => (
              <Marker key={`live-${l.user_id}`} position={[l.lat, l.lng]} icon={liveIcon(TEAM_COLORS[i % TEAM_COLORS.length])}>
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    <b style={{ color: '#050505' }}>{l.user_name || l.user_email}</b>
                    <div style={{ fontSize: 11, color: '#333' }}>{l.team_name || 'Equipe —'}</div>
                    <div style={{ fontSize: 11, color: '#333' }}>Atualizado {new Date(l.updated_at).toLocaleTimeString('pt-BR')}</div>
                    {l.accuracy && <div style={{ fontSize: 10, color: '#666' }}>±{Math.round(l.accuracy)}m</div>}
                  </div>
                </Popup>
              </Marker>
            ))}
            <MarkerClusterGroup
              chunkedLoading
              maxClusterRadius={45}
              iconCreateFunction={(cluster) => L.divIcon({
                html: `<div style="width:40px;height:40px;border-radius:50%;background:rgba(224,255,0,0.85);border:2px solid #050505;display:flex;align-items:center;justify-content:center;color:#050505;font-weight:900;font-family:monospace;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.5);">${cluster.getChildCount()}</div>`,
                className: 'geo-cluster', iconSize: L.point(40, 40),
              })}
            >
              {(teamRoutesList.length
                ? teamRoutesList.flatMap(([tid, r]) => r.stops.map((s, i) => ({ ...s, __order: i + 1, __teamColor: r.color, __teamId: tid })))
                : points.map((p) => ({ ...p, __order: '·', __teamColor: STATUS_COLOR[p.execution_status] || '#00F0FF', __teamId: p.team_id }))
              ).map((p) => (
                <Marker key={`${p.__teamId}-${p.id}`} position={[p.lat, p.lng]} icon={makeIcon(p.__teamColor, p.__order)}>
                  <Popup>
                    <div style={{ minWidth: 200 }}>
                      <div style={{ fontSize: 10, color: '#71717a', fontFamily: 'monospace' }}>{p.project_code || '—'}</div>
                      <b style={{ color: '#050505' }}>{p.name}</b>
                      <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>
                        {PROJECT_TYPE_LABEL[p.project_type] || p.project_type}
                        {p.location ? ` · ${p.location}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: '#333' }}>Equipe: {p.__teamId === 'unassigned' ? '—' : teamName(p.__teamId)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{formatCurrency(p.programmed_value)}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
            {allPolylines.map((pl) => (
              <Polyline key={pl.key} positions={pl.positions} pathOptions={{ color: pl.color, weight: 4, opacity: 0.85, dashArray: pl.dash }} />
            ))}
          </MapContainer>
        )}
      </motion.div>

      {teamRoutesList.length > 0 && (
        <div data-testid="geo-team-routes" className="space-y-3">
          {teamRoutesList.map(([tid, r]) => (
            <div key={tid} data-testid={`geo-team-${tid}`} className="glass-panel rounded-2xl p-4" style={{ borderLeft: `4px solid ${r.color}` }}>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full" style={{ background: r.color }}></span>
                  <div>
                    <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">{tid === 'unassigned' ? 'Sem equipe' : teamName(tid)}</p>
                    <h3 className="font-heading font-black text-lg tracking-tighter text-white">
                      {r.stops.length} parada{r.stops.length !== 1 ? 's' : ''} · {(r.distance_km || 0).toFixed(1)} km
                      {r.duration_min ? ` · ${Math.round(r.duration_min)} min` : ''}
                    </h3>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    data-testid={`geo-export-pdf-${tid}`}
                    onClick={() => exportPdf(tid)}
                    disabled={exporting}
                    className="flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full transition-all disabled:opacity-60"
                  >
                    <FileDown className="w-3 h-3" /> PDF
                  </button>
                  <button
                    data-testid={`geo-share-wa-${tid}`}
                    onClick={() => shareWhatsApp(tid)}
                    className="flex items-center gap-2 bg-[#25D366] hover:bg-[#1DA851] text-white text-xs font-bold px-4 py-2 rounded-full transition-all"
                  >
                    <Share2 className="w-3 h-3" /> WhatsApp
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {r.stops.map((p, i) => (
                  <div key={p.id} data-testid={`geo-stop-${tid}-${i}`} className="flex items-center gap-3 rounded-lg p-2 bg-white/[0.02] border border-white/5 hover:border-white/20 transition-colors">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center font-mono font-bold text-xs flex-shrink-0"
                      style={{ background: `${r.color}22`, border: `1px solid ${r.color}`, color: r.color }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">
                        {p.project_code && <span className="font-mono text-[10px] text-[#00F0FF] mr-1">{p.project_code}</span>}
                        {p.name}
                      </p>
                      <p className="text-[10px] text-zinc-500 truncate">
                        {PROJECT_TYPE_LABEL[p.project_type] || p.project_type}{p.location ? ` · ${p.location}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono text-xs text-[#39FF14]">{formatCurrency(p.programmed_value)}</p>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                        target="_blank" rel="noreferrer"
                        className="text-[10px] text-[#00F0FF] hover:underline"
                      >Maps ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
};
