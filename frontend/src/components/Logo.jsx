import logoSrc from '../assets/logo.png';

export default function Logo({ size = 32 }) {
  return (
    <img
      src={logoSrc}
      alt="Noteblock"
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', display: 'block', flexShrink: 0 }}
    />
  );
}
