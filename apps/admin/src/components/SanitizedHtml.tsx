import { useMemo } from 'react'
import DOMPurify from 'dompurify'

interface SanitizedHtmlProps {
  html?: string | null
  className?: string
}

export function SanitizedHtml({ html, className }: SanitizedHtmlProps) {
  const sanitized = useMemo(() => {
    if (!html) {
      return ''
    }

    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
    })
  }, [html])

  if (!sanitized) {
    return null
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />
}
