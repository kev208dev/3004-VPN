import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

export const BrandShieldLogo: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect x="2" y="2" width="36" height="36" rx="9" fill="#12141A" stroke="rgba(255,255,255,0.12)" />
    <path
      d="M20 8.5L10.5 12.2L11.2 21.4L20 31.5L28.8 21.4L29.5 12.2L20 8.5Z"
      stroke="#F4F4F5"
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
    <circle cx="20" cy="17.8" r="2.6" fill="#22C55E" />
    <path d="M20 20.2V25" stroke="#22C55E" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export const PowerGlyph: React.FC<IconProps> = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v9" />
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
  </svg>
);

export const ShieldCheckIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const GlobeIcon: React.FC<IconProps> = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19" />
    <path d="M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19" />
  </svg>
);

export const SlidersIcon: React.FC<IconProps> = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="#09090B" />
    <circle cx="15" cy="12" r="2" fill="#09090B" />
    <circle cx="10" cy="18" r="2" fill="#09090B" />
  </svg>
);

export const DevicesIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="4" width="14" height="10" rx="2" />
    <path d="M6.5 18h6" />
    <path d="M9.5 14v4" />
    <rect x="15" y="10" width="6.5" height="10" rx="1.6" fill="#09090B" />
    <line x1="17.8" y1="17.5" x2="18.7" y2="17.5" />
  </svg>
);

export const ConsoleIcon: React.FC<IconProps> = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="m8 10 3 2.5L8 15" />
    <line x1="13" y1="15" x2="16" y2="15" />
  </svg>
);

export const RefreshIcon: React.FC<IconProps & { spinning?: boolean }> = ({
  size = 14,
  spinning = false,
}) => (
  <svg
    className={spinning ? 'spin-svg' : undefined}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#4ade80"
    strokeWidth="2.3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const ArrowDownIcon: React.FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);

export const ArrowUpIcon: React.FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const DownloadFileIcon: React.FC<IconProps> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const ServerGearIcon: React.FC<IconProps> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="7" rx="2" />
    <rect x="2" y="14" width="20" height="7" rx="2" />
    <circle cx="6" cy="6.5" r="1" fill="currentColor" />
    <circle cx="6" cy="17.5" r="1" fill="currentColor" />
  </svg>
);

export const SignalBars: React.FC<{ ms?: number | null }> = ({ ms }) => {
  const level = ms == null ? 0 : ms < 55 ? 4 : ms < 130 ? 3 : ms < 240 ? 2 : 1;
  const activeColor = level >= 3 ? '#22C55E' : level === 2 ? '#F59E0B' : '#EF4444';
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 4 + 1}
          y={10 - i * 2.6}
          width="2.6"
          height={3 + i * 2.6}
          rx="1"
          fill={i < level ? activeColor : 'rgba(255,255,255,0.14)'}
        />
      ))}
    </svg>
  );
};

export const RegionCodeBadge: React.FC<{ region: string }> = ({ region }) => {
  const code = (region || 'GL').toUpperCase().slice(0, 2);
  return (
    <span className="region-code-pill">
      {code}
    </span>
  );
};

export const WinMinIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 11 11">
    <rect x="1" y="5" width="9" height="1.1" fill="currentColor" />
  </svg>
);

export const WinMaxIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <rect x="1.5" y="1.5" width="8" height="8" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

export const WinCloseIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.2">
    <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" />
    <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" />
  </svg>
);
