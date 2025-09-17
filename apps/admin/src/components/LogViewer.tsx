import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Terminal, Play, Square, Trash2, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/api'

interface LogEntry {
  id: string
  timestamp: number
  level: number
  msg: string
  runId: string
  source: string
  raw: string
}

interface LogViewerProps {
  runId: string
  className?: string
}

const LOG_LEVELS = {
  10: { name: 'trace', color: 'text-muted-foreground', bg: 'bg-muted/50' },
  20: { name: 'debug', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  30: { name: 'info', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  40: { name: 'warn', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  50: { name: 'error', color: 'text-destructive', bg: 'bg-destructive/10' },
  60: { name: 'fatal', color: 'text-destructive', bg: 'bg-destructive/20' },
}

export function LogViewer({ runId, className }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const scrollToBottom = () => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [logs, autoScroll])

  const connectToStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    // First, try to load historical logs
    loadHistoricalLogs()

    const base = API_BASE_URL.replace(/\/$/, '')
    const eventSource = new EventSource(`${base}/logs/stream/${runId}`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
      setIsStreaming(true)
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'connected') {
          console.log('Connected to log stream for run:', data.runId)
        } else if (data.type === 'log') {
          setLogs(prev => [...prev, data])
        }
      } catch (error) {
        console.error('Error parsing log message:', error)
      }
    }

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error)
      setIsConnected(false)
      eventSource.close()
    }
  }

  const loadHistoricalLogs = async () => {
    try {
      const base = API_BASE_URL.replace(/\/$/, '')
      const response = await fetch(`${base}/logs/history/${runId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.logs && data.logs.length > 0) {
          setLogs(data.logs)
        }
      }
    } catch (error) {
      console.error('Error loading historical logs:', error)
    }
  }

  const disconnectFromStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsConnected(false)
    setIsStreaming(false)
  }

  const clearLogs = () => {
    setLogs([])
  }

  const downloadLogs = () => {
    const logText = logs.map(log => {
      const date = new Date(log.timestamp).toISOString()
      const level = LOG_LEVELS[log.level as keyof typeof LOG_LEVELS]?.name || 'info'
      return `[${date}] ${level.toUpperCase()}: ${log.msg}`
    }).join('\n')
    
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `run-${runId}-logs.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    // Auto-start streaming when component mounts
    connectToStream()
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [runId])

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  }

  return (
    <Card className={cn('flex flex-col h-full', className)}>
      <CardHeader className="flex-shrink-0 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            <CardTitle className="text-lg">Live Logs</CardTitle>
            <Badge 
              variant={isConnected ? 'success' : 'secondary'}
              className="flex items-center gap-1"
            >
              <div className={cn(
                'w-2 h-2 rounded-full',
                isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
              )} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(
                'text-xs',
                autoScroll && 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-700'
              )}
            >
              Auto-scroll
            </Button>
            
            {isStreaming ? (
              <Button
                size="sm"
                variant="outline"
                onClick={disconnectFromStream}
                className="text-xs"
              >
                <Square className="h-3 w-3 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={connectToStream}
                className="text-xs"
              >
                <Play className="h-3 w-3 mr-1" />
                Start
              </Button>
            )}
            
            <Button
              size="sm"
              variant="outline"
              onClick={clearLogs}
              className="text-xs"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
            
            <Button
              size="sm"
              variant="outline"
              onClick={downloadLogs}
              disabled={logs.length === 0}
              className="text-xs"
            >
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 min-h-0">
        <div 
          className="h-full w-full overflow-y-auto overflow-x-hidden" 
          ref={scrollRef}
        >
          <div className="p-4 bg-slate-900 dark:bg-slate-950 text-slate-100 dark:text-slate-100 font-mono text-sm min-h-full">
            {logs.length === 0 ? (
              <div className="text-center text-slate-400 py-8">
                <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No logs available</p>
                <p className="text-xs mt-1">
                  {isStreaming 
                    ? 'Waiting for logs...' 
                    : 'Logs are automatically streamed for active runs. For completed runs, logs may not be available if they were not captured during execution.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {logs.map((log) => {
                  const levelInfo = LOG_LEVELS[log.level as keyof typeof LOG_LEVELS] || LOG_LEVELS[30]
                  
                  return (
                    <div key={log.id} className="flex items-start gap-3 py-1 hover:bg-slate-800/50 dark:hover:bg-slate-800/50 rounded px-2 -mx-2">
                      <div className="text-slate-400 text-xs font-mono flex-shrink-0 w-12">
                        {formatTimestamp(log.timestamp)}
                      </div>
                      
                      <div className={cn(
                        'text-xs px-2 py-0.5 rounded font-medium uppercase flex-shrink-0 w-12 text-center',
                        levelInfo.bg,
                        levelInfo.color
                      )}>
                        {levelInfo.name}
                      </div>
                      
                      {log.source && (
                        <div className="text-blue-400 text-xs flex-shrink-0 w-16 truncate">
                          {log.source}
                        </div>
                      )}
                      
                      <div className="text-slate-100 flex-1 min-w-0">
                        {log.msg}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
