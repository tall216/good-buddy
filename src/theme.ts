// Serious-transceiver color palette. Modeled on real amateur/CB radio
// hardware (Yaesu/Kenwood/Uniden-style brushed aluminum chassis, backlit
// LCD, physical control detailing) rather than a flat "retro" mockup.
export const colors = {
  // Chassis -- brushed gunmetal, not flat black. Panels get real depth
  // via gradients built from these, not a single solid fill.
  chassisDark: '#0d0e10',
  chassisMid: '#1c1e22',
  chassisLight: '#2a2d33',
  bezelHighlight: '#3d4149',

  // Panel surfaces (recessed sub-panels within the chassis)
  panel: '#16181c',
  panelLight: '#20232a',
  panelInset: '#0a0b0d',   // deep-set displays/wells

  // LCD-style primary display (frequency, VU, etc.) -- cool cyan-green,
  // like a real backlit dot-matrix radio LCD, not a warm CRT amber.
  lcdBg: '#0a1410',
  lcdGlow: '#39ff8f',
  lcdGlowDim: '#0f4a2a',
  lcdText: '#7dffb8',

  // Amber -- reserved for secondary indicators/labels (call sign,
  // range), giving two distinct "instrument" colors like a real radio's
  // mixed indicator lighting instead of one color doing everything.
  amber: '#ffa620',
  amberDim: '#5c3d10',
  amberGlow: 'rgba(255, 166, 32, 0.35)',

  // Status/signal colors
  green: '#39ff8f',
  greenDim: '#0f4a2a',
  red: '#e8341c',
  redBright: '#ff4d2e',
  redDim: '#4a1208',

  // Text
  text: '#c8ccd4',
  textDim: '#63666e',
  white: '#f4f6f8',

  // Physical detailing
  screwSlot: '#0a0b0d',
  screwHighlight: '#4a4e56',
  knobBody: '#2e3138',
  knobRing: '#454952',
  borderLight: 'rgba(255,255,255,0.06)',
  borderDark: 'rgba(0,0,0,0.5)',
};

export const fonts = {
  mono: 'monospace',
  display: 'monospace',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  sm: 3,
  md: 6,
  lg: 10,
  xl: 16,
};
