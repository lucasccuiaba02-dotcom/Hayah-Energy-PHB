import proj4 from 'proj4';

// SIRGAS 2000 / UTM zone 21S (Cuiabá / Mato Grosso)
// EPSG:31981
const UTM_21S = '+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

/**
 * Converts UTM Zone 21 South (SIRGAS 2000 / WGS84) coordinates to WGS84 lat/lng
 * @param {string|number} utm_x - Easting (metros)
 * @param {string|number} utm_y - Northing (metros)
 * @returns {{lat:number, lng:number}|null}
 */
export function utm21sToLatLng(utm_x, utm_y) {
  const x = parseFloat(String(utm_x).replace(',', '.').trim());
  const y = parseFloat(String(utm_y).replace(',', '.').trim());
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // Sanity: MT UTM21S easting ~ 400k-800k, northing ~ 8100000-8500000
  try {
    const [lng, lat] = proj4(UTM_21S, WGS84, [x, y]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // basic bounds sanity
    if (lat < -35 || lat > 5 || lng < -75 || lng > -34) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Nearest neighbor TSP: given an origin and list of points, returns an ordered visit path
 * @param {{lat:number,lng:number}} origin
 * @param {{id:string,lat:number,lng:number}[]} points
 * @returns {{id:string,lat:number,lng:number}[]} ordered list starting from nearest
 */
export function nearestNeighborRoute(origin, points) {
  const remaining = [...points];
  const path = [];
  let current = origin;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
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

function toRad(d) { return (d * Math.PI) / 180; }
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Uses OSRM public API to get real driving route through all waypoints in order.
 * Returns { coordinates: [[lat,lng]...], distance_km, duration_min } or null.
 */
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
  } catch {
    return null;
  }
}
