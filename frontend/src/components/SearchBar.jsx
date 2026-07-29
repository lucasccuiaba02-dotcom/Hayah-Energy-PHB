import React from 'react';
import { Search } from 'lucide-react';

/**
 * Global search bar reused across pages. Filters by project code + name.
 */
export const SearchBar = ({ value, onChange, placeholder = 'Buscar por código ou nome da obra...', testid = 'search-bar' }) => (
  <div className="relative flex-1 min-w-[240px]">
    <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
    <input
      data-testid={testid}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none"
    />
  </div>
);
