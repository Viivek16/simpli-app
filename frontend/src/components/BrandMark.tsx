import { useId } from 'react';

type Props = { size?: number };

/** SIMPLI brand mark: amber S wrapped by a silver planetary ring with a green planet on the front arc.
    Below 28px the strokes switch to a thicker cut so the mark holds at header sizes. */
export const BrandMark = ({ size = 26 }: Props) => {
  const uid = useId();
  const gradS = `bmAmber-${uid}`;
  const gradP = `bmPlanet-${uid}`;
  const thick = size <= 28;
  const sW = thick ? 11 : 8;
  const rW = thick ? 4 : 2.6;
  const backOp = thick ? 0.3 : 0.22;
  const pR = thick ? 6 : 4.6;
  const haloR = thick ? 8.5 : 7;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradS} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFC46B" /><stop offset="100%" stopColor="#E8963A" />
        </linearGradient>
        <radialGradient id={gradP} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#B9F7D2" /><stop offset="100%" stopColor="#6FE29B" />
        </radialGradient>
      </defs>
      <g transform="translate(-2 7)">
        <g transform="rotate(-26 50 43)">
          <path d="M 10 43 A 40 12.5 0 0 1 90 43" fill="none" stroke="#F4F6FB" strokeOpacity={backOp} strokeWidth={rW} />
        </g>
        <path d="M 64 27 C 64 17 37 17 37 30 C 37 43 63 43 63 56 C 63 69 36 69 36 59" fill="none" stroke={`url(#${gradS})`} strokeWidth={sW} strokeLinecap="round" />
        <g transform="rotate(-26 50 43)">
          <path d="M 10 43 A 40 12.5 0 0 0 90 43" fill="none" stroke="#F4F6FB" strokeOpacity="0.85" strokeWidth={rW} />
          <circle cx="82.8" cy="50.2" r={haloR} fill="#6FE29B" opacity="0.25" />
          <circle cx="82.8" cy="50.2" r={pR} fill={`url(#${gradP})`} />
        </g>
      </g>
    </svg>
  );
};
