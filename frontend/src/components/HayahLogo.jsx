import React from 'react';

export const HayahLogo = ({ size = 'md', showText = true, className = '' }) => {
  const sizes = {
    sm: { icon: 'w-8 h-8', text: 'text-sm' },
    md: { icon: 'w-12 h-12', text: 'text-base' },
    lg: { icon: 'w-16 h-16', text: 'text-2xl' },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center gap-3 ${className}`} data-testid="hayah-logo">
      <div className={`${s.icon} relative flex items-center justify-center`}>
        <div
          className="absolute inset-0 rounded-xl"
          style={{
            background: 'linear-gradient(135deg, #E0FF00 0%, #39FF14 50%, #00F0FF 100%)',
          }}
        ></div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="relative z-10"
          style={{ width: '60%', height: '60%' }}
        >
          <path
            d="M13 2L4.5 12.5H11L10 22L19.5 11.5H13L14 2H13Z"
            fill="#050505"
            stroke="#050505"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {showText && (
        <div>
          <p className={`font-heading font-black tracking-tighter text-white leading-none ${s.text}`}>
            HAYAH
          </p>
          <p
            className={`font-heading font-bold tracking-[0.3em] leading-none mt-1`}
            style={{
              color: '#E0FF00',
              fontSize: size === 'lg' ? '0.75rem' : '0.55rem',
            }}
          >
            ENERGY
          </p>
        </div>
      )}
    </div>
  );
};
