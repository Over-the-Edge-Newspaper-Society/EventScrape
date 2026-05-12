const DEMO_MODE_KEY = 'eventscrape.demo'

export function isDemoRuntimePath(pathname = window.location.pathname) {
  return pathname === '/demo' || pathname.startsWith('/demo/')
}

export function isAppRuntimePath(pathname = window.location.pathname) {
  return pathname === '/app' || pathname.startsWith('/app/')
}

export function isDemoMode() {
  if (typeof window === 'undefined') {
    return false
  }

  if (isDemoRuntimePath(window.location.pathname)) {
    return true
  }

  const params = new URLSearchParams(window.location.search)
  if (params.has('demo')) {
    const value = params.get('demo')
    const enabled = value !== '0' && value !== 'false'
    localStorage.setItem(DEMO_MODE_KEY, enabled ? '1' : '0')
    return enabled
  }

  return localStorage.getItem(DEMO_MODE_KEY) === '1'
}

export function setDemoMode(enabled: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  localStorage.setItem(DEMO_MODE_KEY, enabled ? '1' : '0')
}
