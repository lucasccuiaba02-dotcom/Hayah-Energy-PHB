import proj4 from 'proj4';

// SIRGAS 2000 / UTM zone 21S (Cuiabá / MT) — EPSG:31981
const UTM_21S = '+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

export function utm21sToLatLng(utm_x, utm_y) {
  const x = parseFloat(String(utm_x).replace(',', '.').trim());
  const y = parseFloat(String(utm_y).replace(',', '.').trim());
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  try {
    const [lng, lat] = proj4(UTM_21S, WGS84, [x, y]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -35 || lat > 5 || lng < -75 || lng > -34) return null;
    return { lat, lng };
  } catch { return null; }
}

export function latLngToUtm21s(lat, lng) {
  const la = parseFloat(lat);
  const lo = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  try {
    const [x, y] = proj4(WGS84, UTM_21S, [lo, la]);
    return { utm_x: Math.round(x), utm_y: Math.round(y) };
  } catch { return null; }
}

/**
 * Nominatim geocoding (OpenStreetMap). Free — rate limit 1 req/s.
 * Restringido para Brasil.
 */
export async function geocodeAddress(query, { limit = 5, signal } = {}) {
  if (!query || query.trim().length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${limit}&countrycodes=br&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'Accept-Language': 'pt-BR' },
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((it) => ({
      display: it.display_name,
      lat: parseFloat(it.lat),
      lng: parseFloat(it.lon),
      city: it.address?.city || it.address?.town || it.address?.village || it.address?.municipality || '',
      state: it.address?.state || '',
      raw: it,
    }));
  } catch { return []; }
}

/**
 * Nearest neighbor TSP. Returns visit order from origin.
 */
export function nearestNeighborRoute(origin, points) {
  const remaining = [...points];
  const path = [];
  let current = origin;
  while (remaining.length) {
    let bestIdx = 0, bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i]);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    path.push(next);
    current = next;
  }
  return path;
}

const toRad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function osrmRoute(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;
  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || !data.routes.length) return null;
    const r = data.routes[0];
    return {
      coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance_km: r.distance / 1000,
      duration_min: r.duration / 60,
    };
  } catch { return null; }
}
