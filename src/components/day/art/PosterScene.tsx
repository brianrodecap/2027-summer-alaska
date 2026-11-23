import { useId } from 'react';

import type { SceneName } from './sceneFor';

// Flat WPA-poster landscapes for the day poster and the day-list thumbnails. The
// colors are artwork, not theme tokens: they read the same in light and dark, like
// a photo would.

// Gradient and clip ids, made unique per drawn scene so several on one page never
// share a definition.
type Ids = (name: string) => string;

const Sky = ({ id, from, to, mid }: { id: string; from: string; to: string; mid?: string }) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stopColor={from} />
    {mid && <stop offset=".7" stopColor={mid} />}
    <stop offset="1" stopColor={to} />
  </linearGradient>
);

const Drive = ({ id }: { id: Ids }) => (
  <>
    <defs>
      <Sky id={id('sky')} from="#8fb4cf" mid="#f3d9a4" to="#f3d9a4" />
    </defs>
    <rect width="400" height="240" fill={`url(#${id('sky')})`} />
    <circle cx="300" cy="78" r="26" fill="#f2c14e" />
    <path
      d="M0 140 L50 98 L95 126 L150 72 L205 118 L250 88 L300 122 L350 92 L400 116 V240 H0Z"
      fill="#6f8fae"
    />
    <path d="M0 160 L70 128 L130 150 L190 120 L260 152 L330 126 L400 148 V240 H0Z" fill="#3f5f7a" />
    <path d="M0 178 C100 168 300 172 400 166 V240 H0Z" fill="#7d8a49" />
    <path d="M0 200 C120 190 280 196 400 188 V240 H0Z" fill="#5b6b35" />
    <path d="M150 240 C180 210 196 190 204 172 L210 172 C214 192 240 214 290 240Z" fill="#d9b98a" />
    <path
      d="M180 240 C196 214 204 194 207 172"
      stroke="#fff6e6"
      strokeWidth="1.5"
      strokeDasharray="5 6"
      fill="none"
    />
    <path d="M0 176 L120 172 L200 170" stroke="#9aa3a8" strokeWidth="2.2" fill="none" />
  </>
);

const Flight = ({ id }: { id: Ids }) => (
  <>
    <defs>
      <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2f5f8f" />
        <stop offset=".55" stopColor="#c96b48" />
        <stop offset="1" stopColor="#f2c14e" />
      </linearGradient>
    </defs>
    <rect width="400" height="240" fill={`url(#${id('sky')})`} />
    <path
      d="M20 190 Q200 20 380 150"
      stroke="#fff6e6"
      strokeWidth="2"
      strokeDasharray="6 7"
      fill="none"
      opacity=".8"
    />
    <g transform="translate(232 70) rotate(18)" fill="#fff6e6">
      <path d="M-22 0 L22 0 L28 -3 L22 -5 L-20 -3Z" />
      <path d="M-4 -3 L8 -20 L14 -20 L6 -3Z" />
      <path d="M-4 0 L8 14 L14 14 L6 0Z" />
      <path d="M-20 -3 L-26 -12 L-21 -12 L-14 -3Z" />
    </g>
    <g fill="#fbe6b8" opacity=".9">
      <ellipse cx="70" cy="200" rx="90" ry="22" />
      <ellipse cx="170" cy="214" rx="80" ry="20" />
      <ellipse cx="320" cy="206" rx="110" ry="26" />
    </g>
    <rect y="214" width="400" height="30" fill="#f6efe0" />
  </>
);

// Clear on the left, cloudy on the right: the two plans of a scenario day.
const Split = ({ id }: { id: Ids }) => {
  const mountains = 'M0 150 L60 86 L100 122 L160 60 L215 116 L260 80 L320 128 L400 96 V240 H0Z';
  const foothills = 'M0 176 L90 148 L170 170 L260 140 L400 168 V240 H0Z';
  return (
    <>
      <defs>
        <Sky id={id('clear')} from="#6fa3d0" to="#e6eef2" />
        <Sky id={id('cloud')} from="#7d8790" to="#b9bfc2" />
        <clipPath id={id('right')}>
          <path d="M230 0 H400 V240 H150Z" />
        </clipPath>
      </defs>
      <rect width="400" height="240" fill={`url(#${id('clear')})`} />
      <circle cx="90" cy="60" r="20" fill="#f2c14e" />
      <path d={mountains} fill="#5d7c99" />
      <path d="M150 60 L160 60 L172 72 L148 72Z M255 80 L262 80 L272 92 L250 92Z" fill="#f6efe0" />
      <path d={foothills} fill="#3e5a3c" />
      <g transform="translate(120 96) rotate(-8)" fill="#2b2216">
        <path d="M-12 0 L12 0 L15 -2 L12 -3 L-11 -2Z" />
        <path d="M-2 -2 L5 -11 L8 -11 L3 -2Z" />
      </g>
      <g clipPath={`url(#${id('right')})`}>
        <rect width="400" height="240" fill={`url(#${id('cloud')})`} />
        <path d={mountains} fill="#59636b" />
        <path d={foothills} fill="#46503f" />
        <g fill="#d5d9db">
          <ellipse cx="290" cy="70" rx="80" ry="24" />
          <ellipse cx="360" cy="96" rx="70" ry="20" />
          <ellipse cx="230" cy="104" rx="60" ry="16" />
        </g>
        <g stroke="#e6eaec" strokeWidth="1.5" opacity=".7">
          <path d="M260 120 l-6 18M290 118 l-6 18M320 124 l-6 18M350 116 l-6 18M380 122 l-6 18" />
        </g>
      </g>
      <path d="M230 0 L150 240" stroke="#fff6e6" strokeWidth="3" />
    </>
  );
};

const Sea = ({ id }: { id: Ids }) => (
  <>
    <defs>
      <Sky id={id('sky')} from="#a9c9df" to="#eaf3fb" />
    </defs>
    <rect width="400" height="240" fill={`url(#${id('sky')})`} />
    <path d="M0 120 L70 70 L130 104 L200 54 L270 100 L340 66 L400 92 V170 H0Z" fill="#7f9fb8" />
    <path d="M110 170 L130 120 L170 112 L220 118 L270 110 L300 130 L310 170Z" fill="#eef6fa" />
    <path
      d="M140 170 L150 132 M180 170 L186 120 M230 170 L236 122 M270 170 L276 118"
      stroke="#a7cde0"
      strokeWidth="3"
    />
    <rect y="168" width="400" height="72" fill="#2f5f8f" />
    <g stroke="#5d8cbc" strokeWidth="2">
      <path d="M20 190 h50 M120 204 h70 M260 192 h60 M300 218 h80 M40 226 h60" />
    </g>
    <g transform="translate(40 150)">
      <path d="M0 18 L120 18 L110 30 L8 30Z" fill="#fff6e6" />
      <rect x="18" y="6" width="80" height="12" fill="#fff6e6" />
      <rect x="18" y="12" width="80" height="2" fill="#2f5f8f" />
      <rect x="36" y="0" width="40" height="7" fill="#fff6e6" />
      <rect x="64" y="-6" width="8" height="8" fill="#c96b48" />
    </g>
  </>
);

const Port = ({ id }: { id: Ids }) => (
  <>
    <defs>
      <Sky id={id('sky')} from="#9cbcd4" to="#e9e2cc" />
    </defs>
    <rect width="400" height="240" fill={`url(#${id('sky')})`} />
    <path d="M0 110 L60 70 L120 100 L190 56 L260 96 L330 64 L400 90 V170 H0Z" fill="#6f8a9a" />
    <path d="M0 150 C60 120 120 140 180 124 S300 112 400 132 V176 H0Z" fill="#2f4a33" />
    <g fill="#2f4a33">
      <path d="M30 140 l8 -22 l8 22Z M60 134 l7 -20 l7 20Z M330 128 l8 -22 l8 22Z M360 132 l7 -20 l7 20Z" />
    </g>
    <g>
      <rect x="210" y="146" width="26" height="18" fill="#c96b48" />
      <path d="M206 146 L223 134 L240 146Z" fill="#7a3a22" />
      <rect x="244" y="150" width="20" height="14" fill="#e0a83a" />
      <rect x="180" y="152" width="22" height="12" fill="#d8cfb8" />
    </g>
    <rect y="168" width="400" height="72" fill="#365f84" />
    <rect x="150" y="164" width="140" height="6" fill="#6b4a33" />
    <g transform="translate(250 140)">
      <path d="M0 22 L140 22 L128 36 L8 36Z" fill="#fff6e6" />
      <rect x="16" y="6" width="104" height="16" fill="#fff6e6" />
      <rect x="16" y="13" width="104" height="2" fill="#2f5f8f" />
      <rect x="40" y="-2" width="50" height="9" fill="#fff6e6" />
    </g>
    <g stroke="#6f9bc4" strokeWidth="2">
      <path d="M20 200 h60 M110 216 h50 M40 228 h70" />
    </g>
  </>
);

const Tundra = () => (
  <>
    <rect width="400" height="240" fill="#c9dbe6" />
    <path d="M0 130 L80 80 L150 118 L230 70 L320 120 L400 90 V240 H0Z" fill="#7c8f9e" />
    <path d="M0 170 C100 150 260 160 400 146 V240 H0Z" fill="#8a7a4a" />
    <path d="M0 200 C120 186 260 196 400 184 V240 H0Z" fill="#6b5b33" />
  </>
);

const River = () => (
  <>
    <rect width="400" height="240" fill="#d6e4ec" />
    <path d="M0 140 L100 100 L200 130 L300 96 L400 124 V240 H0Z" fill="#5e7a6a" />
    <path d="M0 180 C120 168 260 176 400 162 V200 C260 214 120 206 0 218Z" fill="#4b7da6" />
    <path d="M0 218 C120 206 260 214 400 200 V240 H0Z" fill="#3e5a3c" />
    <path d="M40 160 L360 150" stroke="#cfd6d8" strokeWidth="6" />
  </>
);

const Cabin = () => (
  <>
    <rect width="400" height="240" fill="#e9d9b8" />
    <path d="M0 150 L120 110 L250 140 L400 100 V240 H0Z" fill="#6f8fae" />
    <path d="M120 200 V130 L200 80 L280 130 V200Z" fill="#7a4a2c" />
    <rect x="180" y="150" width="40" height="50" fill="#f2c14e" />
    <path d="M0 200 H400 V240 H0Z" fill="#4f6a3c" />
  </>
);

const Town = () => (
  <>
    <rect width="400" height="240" fill="#b9cfdf" />
    <path d="M0 120 L90 70 L170 110 L260 60 L400 110 V240 H0Z" fill="#8ea7b8" />
    <g fill="#3f5f7a">
      <rect x="60" y="120" width="40" height="90" />
      <rect x="110" y="96" width="34" height="114" />
      <rect x="154" y="134" width="50" height="76" />
      <rect x="214" y="110" width="30" height="100" />
    </g>
    <rect y="204" width="400" height="40" fill="#5b6b35" />
  </>
);

const Whale = () => (
  <>
    <rect width="400" height="240" fill="#a9c9df" />
    <path d="M0 110 L100 80 L200 104 L300 74 L400 100 V130 H0Z" fill="#6f8a9a" />
    <rect y="128" width="400" height="112" fill="#2f5f8f" />
    <path d="M150 180 C180 120 240 120 260 170 L250 176 C236 150 196 150 176 186Z" fill="#1d2b38" />
    <path d="M262 168 l26 -22 l-4 22 l22 4Z" fill="#1d2b38" />
  </>
);

const SCENES: Record<SceneName, (props: { id: Ids }) => React.JSX.Element> = {
  drive: Drive,
  flight: Flight,
  split: Split,
  sea: Sea,
  port: Port,
  tundra: Tundra,
  river: River,
  cabin: Cabin,
  town: Town,
  whale: Whale,
};

// One scene, filling its parent (which positions it) and cropped to fit.
export function PosterScene({ scene }: { scene: SceneName }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const Scene = SCENES[scene];
  return (
    <svg
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <Scene id={(name) => `${scene}-${name}-${uid}`} />
    </svg>
  );
}
