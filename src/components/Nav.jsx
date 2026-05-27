import { motion, AnimatePresence } from 'framer-motion'
import Icon from './ui/Icon'

const BROKER_LABEL = {
  connecting:   'CONNECTING',
  connected:    'ONLINE',
  reconnecting: 'RECONNECTING',
  error:        'ERROR',
  offline:      'OFFLINE',
}

export default function Nav({
  page, setPage, activeCount, deviceCount,
  tweaks, onToggleTheme, onToggleTweaks, tweaksOpen,
  profile, mqttStatus = 'offline', mobileOpen, onCloseMobile,
}) {
  const items = [
    { id: 'devices',  label: 'Devices',  icon: 'bulb',    badge: `${activeCount}/${deviceCount}` },
    { id: 'chat',     label: 'AI Chat',  icon: 'sparkle', badge: 'live' },
    { id: 'settings', label: 'Settings', icon: 'gear',    badge: null },
  ]

  const displayName = profile?.displayName || 'User'
  const initials = profile?.displayInitials || displayName[0]?.toUpperCase() || 'U'

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="sh-nav-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCloseMobile}
          />
        )}
      </AnimatePresence>

      <nav className={`sh-nav ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Brand */}
        <div className="sh-nav-brand">
          <img
            src="/logo.jpg"
            alt="Synapta"
            style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          />
          <div>
            <div className="sh-brand-name">SynaptaOS</div>
            <div className="sh-brand-sub mono">Synapta Tech</div>
          </div>
        </div>

        {/* Nav items */}
        <div className="sh-nav-section-label mono">WORKSPACE</div>
        <ul className="sh-nav-list">
          {items.map(it => (
            <li key={it.id}>
              <button
                className={`sh-nav-item ${page === it.id ? 'on' : ''}`}
                onClick={() => { setPage(it.id); onCloseMobile() }}
              >
                <span className="sh-nav-item-icon"><Icon name={it.icon} size={16} /></span>
                <span className="sh-nav-item-label">{it.label}</span>
                {it.badge && (
                  <span className={`sh-nav-item-badge mono ${it.badge === 'live' ? 'sh-nav-live' : ''}`}>
                    {it.badge === 'live' ? <i /> : null}
                    {it.badge}
                  </span>
                )}
                {page === it.id && (
                  <motion.span
                    className="sh-nav-item-rail"
                    layoutId="nav-rail"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Status */}
        <div className="sh-nav-section-label mono">SYSTEM</div>
        <div className="sh-nav-status mono">
          <div className="sh-nav-status-row">
            <span>BROKER</span>
            {mqttStatus === 'connected'
              ? <span className="sh-live"><i />{BROKER_LABEL.connected}</span>
              : <span style={{ color: mqttStatus === 'error' ? 'oklch(0.65 0.22 25)' : 'var(--ink-xdim)' }}>
                  {BROKER_LABEL[mqttStatus] ?? 'OFFLINE'}
                </span>
            }
          </div>
          <div className="sh-nav-status-row">
            <span>QoS</span><span>1 · at-least-once · MQTT 5</span>
          </div>
        </div>

        {/* Footer */}
        <div className="sh-nav-foot">
          <button className="sh-icon-btn" onClick={onToggleTheme} title="Toggle theme">
            <Icon name={tweaks.theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <button className={`sh-icon-btn ${tweaksOpen ? 'on' : ''}`} onClick={onToggleTweaks} title="Tweaks">
            <Icon name="sparkle" size={16} />
          </button>
          <div className="sh-user">
            <div className="sh-user-av">{initials}</div>
            <div className="sh-user-meta">
              <div className="sh-user-name">{displayName}</div>
            </div>
          </div>
        </div>
      </nav>
    </>
  )
}

export function MobileTopbar({ page, onOpenMenu, tweaks, onToggleTheme }) {
  const labels = { devices: 'Devices', chat: 'AI Chat', settings: 'Settings' }
  return (
    <div className="sh-mobile-bar">
      <button className="sh-icon-btn" onClick={onOpenMenu}>
        <Icon name="menu" size={18} />
      </button>
      <div className="flex items-center">
        <span className="sh-brand-name text-sm">SynaptaOS</span>
        <span className="mono text-[10px] ml-2" style={{ color: 'var(--ink-xdim)' }}>
          · {labels[page]}
        </span>
      </div>
      <button className="sh-icon-btn" onClick={onToggleTheme}>
        <Icon name={tweaks.theme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>
    </div>
  )
}

export function MobileBottomNav({ page, setPage, activeCount, deviceCount }) {
  const items = [
    { id: 'devices',  label: 'Devices',  icon: 'bulb',    badge: `${activeCount}/${deviceCount}` },
    { id: 'chat',     label: 'Chat',     icon: 'sparkle' },
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ]
  return (
    <nav className="sh-bottom-nav">
      {items.map(it => (
        <button
          key={it.id}
          className={`sh-bottom-nav-item ${page === it.id ? 'on' : ''}`}
          onClick={() => setPage(it.id)}
        >
          <span className="sh-bottom-nav-icon relative">
            <Icon name={it.icon} size={20} />
            {it.badge && (
              <span className="sh-bottom-nav-badge mono">{it.badge}</span>
            )}
          </span>
          <span className="sh-bottom-nav-label mono">{it.label}</span>
        </button>
      ))}
    </nav>
  )
}
