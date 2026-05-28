export default function Icon({ name, size = 18 }) {
  const s = {
    width: size,
    height: size,
    strokeWidth: 1.4,
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    flexShrink: 0,
  }
  switch (name) {
    case 'lamp':    return <svg viewBox="0 0 24 24" {...s}><path d="M7 3h10l-2 8H9z"/><path d="M12 11v7"/><path d="M8 20h8"/></svg>
    case 'bulb':    return <svg viewBox="0 0 24 24" {...s}><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c1 1 1.5 2 1.5 3.5h5c0-1.5.5-2.5 1.5-3.5A6 6 0 0 0 12 3z"/></svg>
    case 'blind':   return <svg viewBox="0 0 24 24" {...s}><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M4 13h16M4 17h16"/></svg>
    case 'kettle':  return <svg viewBox="0 0 24 24" {...s}><path d="M5 10h12l-1 9H6z"/><path d="M17 12h2a2 2 0 0 1 0 4h-2"/><path d="M8 7c0-1 1-2 2-2h2c1 0 2 1 2 2"/></svg>
    case 'fan':     return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 2-7 5-7 0 4-2 6-5 7zM12 14c0 4-2 7-5 7 0-4 2-6 5-7zM10 12c-4 0-7-2-7-5 4 0 6 2 7 5zM14 12c4 0 7 2 7 5-4 0-6-2-7-5z"/></svg>
    case 'ac':      return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="5" width="18" height="9" rx="2"/><path d="M7 14v2M12 14v3M17 14v2"/><path d="M6 9h12"/></svg>
    case 'lock':    return <svg viewBox="0 0 24 24" {...s}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    case 'cam':     return <svg viewBox="0 0 24 24" {...s}><path d="M3 7h11l3 3v7a1 1 0 0 1-1 1H3z"/><circle cx="10" cy="13" r="2.5"/><path d="M18 10l3-2v10l-3-2"/></svg>
    case 'ev':      return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="5" width="12" height="14" rx="2"/><path d="M7 10h4M7 14h4"/><path d="M15 9h2l2 3v5a1 1 0 0 1-2 0v-2h-2"/></svg>
    case 'plus':    return <svg viewBox="0 0 24 24" {...s}><path d="M12 5v14M5 12h14"/></svg>
    case 'send':    return <svg viewBox="0 0 24 24" {...s}><path d="M4 12l16-8-6 16-3-7z"/></svg>
    case 'gear':    return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
    case 'sun':     return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    case 'moon':    return <svg viewBox="0 0 24 24" {...s}><path d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11z"/></svg>
    case 'close':   return <svg viewBox="0 0 24 24" {...s}><path d="M6 6l12 12M18 6L6 18"/></svg>
    case 'sparkle': return <svg viewBox="0 0 24 24" {...s}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/></svg>
    case 'bolt':    return <svg viewBox="0 0 24 24" {...s}><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
    case 'shield':  return <svg viewBox="0 0 24 24" {...s}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>
    case 'menu':    return <svg viewBox="0 0 24 24" {...s}><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    case 'trash':   return <svg viewBox="0 0 24 24" {...s}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    case 'check':   return <svg viewBox="0 0 24 24" {...s}><path d="M20 6L9 17l-5-5"/></svg>
    case 'mic':     return <svg viewBox="0 0 24 24" {...s}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M8 21h8"/></svg>
    case 'micOff':  return <svg viewBox="0 0 24 24" {...s}><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V6a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><path d="M12 19v2M8 23h8"/><path d="M2 2l20 20"/></svg>
    case 'qr':      return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M17 17h4v4"/></svg>
    case 'scan':    return <svg viewBox="0 0 24 24" {...s}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>
    case 'share':   return <svg viewBox="0 0 24 24" {...s}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
    case 'download':return <svg viewBox="0 0 24 24" {...s}><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>
    case 'alert':   return <svg viewBox="0 0 24 24" {...s}><path d="M12 3L2 20h20z"/><path d="M12 10v5M12 18v.5"/></svg>
    case 'upload':  return <svg viewBox="0 0 24 24" {...s}><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/></svg>
    case 'image':   return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
    case 'external':return <svg viewBox="0 0 24 24" {...s}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    case 'x':       return <svg viewBox="0 0 24 24" {...s}><path d="M6 6l12 12M18 6L6 18"/></svg>
    case 'copy':    return <svg viewBox="0 0 24 24" {...s}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    case 'gauge':   return <svg viewBox="0 0 24 24" {...s}><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 14l3.5-3.5"/><circle cx="12" cy="14" r="1.5"/></svg>
    default: return null
  }
}
