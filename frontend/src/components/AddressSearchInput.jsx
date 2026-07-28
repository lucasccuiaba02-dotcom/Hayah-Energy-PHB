import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import { geocodeAddress, latLngToUtm21s } from '../lib/geo';

/**
 * Address search input using OSM Nominatim. On selection, calls onSelect with:
 * { display, lat, lng, city, state, utm_x, utm_y }
 */
export const AddressSearchInput = ({ onSelect, placeholder = 'Buscar endereço (rua, nº, cidade)…', testid = 'address-search' }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.trim().length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      const list = await geocodeAddress(q, { signal: abortRef.current.signal });
      setResults(list);
      setOpen(true);
      setLoading(false);
    }, 450);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q]);

  const handlePick = (r) => {
    const utm = latLngToUtm21s(r.lat, r.lng);
    onSelect({ ...r, utm_x: utm?.utm_x || '', utm_y: utm?.utm_y || '' });
    setQ(r.display);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative" data-testid={testid}>
      <div className="flex items-center gap-2 bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2.5 focus-within:border-[#00F0FF] transition-colors">
        {loading ? (
          <Loader2 className="w-4 h-4 text-[#00F0FF] animate-spin flex-shrink-0" />
        ) : (
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
        )}
        <input
          data-testid={`${testid}-input`}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 focus:outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <div
          data-testid={`${testid}-results`}
          className="absolute z-30 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg bg-zinc-950 border border-white/10 shadow-2xl"
        >
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              data-testid={`${testid}-result-${i}`}
              onClick={() => handlePick(r)}
              className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-b-0 flex items-start gap-2"
            >
              <MapPin className="w-3 h-3 text-[#00F0FF] mt-1 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white truncate">{r.display}</p>
                <p className="text-[10px] text-zinc-500 font-mono">
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  {r.city && ` · ${r.city}`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && !loading && q.trim().length >= 3 && results.length === 0 && (
        <div className="absolute z-30 mt-1 left-0 right-0 rounded-lg bg-zinc-950 border border-white/10 px-3 py-3 text-xs text-zinc-500">
          Nenhum resultado. Tente refinar o endereço.
        </div>
      )}
    </div>
  );
};
