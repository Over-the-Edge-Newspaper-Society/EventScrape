import { FastifyPluginAsync } from 'fastify';
import IORedis from 'ioredis';

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

  // Server-Sent Events endpoint for live logs
  fastify.get('/stream/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    
    if (!runId || typeof runId !== 'string') {
      reply.status(400);
      return { error: 'Invalid run ID' };
    }

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Function to send SSE message
    const sendEvent = (data: any, event = 'message') => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const streamKey = `logs:${runId}`;
    let lastId = '$'; // Updated after we replay existing entries
    
    // Use a dedicated Redis connection for this stream so BLOCK reads don't affect others
    const redisStreamClient = redis.duplicate();
    let isClosed = false;
    let heartbeat: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      redisStreamClient.quit().catch(() => redisStreamClient.disconnect());
      reply.raw.end();
    };
    
    try {
      await redisStreamClient.connect();
    } catch (error) {
      console.error('Failed to connect to Redis for log stream:', error);
      sendEvent({ type: 'error', message: 'Failed to connect to log stream' }, 'error');
      cleanup();
      return;
    }

    heartbeat = setInterval(() => {
      if (!isClosed) {
        // Comment lines are ignored by SSE clients but keep proxy connections alive
        reply.raw.write(': heartbeat\n\n');
      }
    }, 15000);

    // Send initial connection event
    sendEvent({ type: 'connected', runId });

    // Read existing logs first
    try {
      const existingLogs = await redisStreamClient.xrange(streamKey, '-', '+', 'COUNT', 1000);
      for (const [id, fields] of existingLogs) {
        const logData: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          logData[fields[i]] = fields[i + 1];
        }
        sendEvent({
          type: 'log',
          id,
          timestamp: parseInt(logData.timestamp) || Date.now(),
          level: parseInt(logData.level) || 30,
          msg: logData.msg || '',
          runId: logData.runId || runId,
          source: logData.source || '',
          raw: logData.raw || ''
        });
        lastId = id;
      }

      // If no historical logs were found we need to start from the beginning
      // so new entries are not skipped when XREAD sees '$'.
      if (lastId === '$') {
        lastId = '0-0';
      }
      
      // Trim old logs to prevent memory issues - keep only last 2000 entries
      try {
        await redisStreamClient.xtrim(streamKey, 'MAXLEN', '~', 2000);
      } catch (trimError) {
        console.warn('Error trimming log stream:', trimError);
      }
    } catch (error: any) {
      console.error('Error reading existing logs:', error);
    }

    const streamLoop = async () => {
      while (!isClosed) {
        try {
          const newLogs = await redisStreamClient.call(
            'XREAD', 'BLOCK', 5000, 'COUNT', 50, 'STREAMS', streamKey, lastId
          ) as any;
          
          if (newLogs && newLogs.length > 0) {
            const [, logs] = newLogs[0];
            
            for (const [id, fields] of logs) {
              const logData: Record<string, string> = {};
              for (let i = 0; i < fields.length; i += 2) {
                logData[fields[i]] = fields[i + 1];
              }
              
              sendEvent({
                type: 'log',
                id,
                timestamp: parseInt(logData.timestamp) || Date.now(),
                level: parseInt(logData.level) || 30,
                msg: logData.msg || '',
                runId: logData.runId || runId,
                source: logData.source || '',
                raw: logData.raw || ''
              });
              
              lastId = id;
            }
          }
        } catch (error: any) {
          if (isClosed) {
            break;
          }
          
          console.error('Error reading logs:', error);
          // Small delay before retrying to avoid tight error loop
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    };

    streamLoop().catch((error) => {
      console.error('Log stream loop crashed:', error);
      cleanup();
    });

    // Clean up on connection close
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });

  // Get historical logs for a run
  fastify.get('/history/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const { limit = '1000', start = '-', end = '+' } = request.query as any;
    
    if (!runId || typeof runId !== 'string') {
      reply.status(400);
      return { error: 'Invalid run ID' };
    }

    try {
      const streamKey = `logs:${runId}`;
      const logs = await redis.xrange(streamKey, start, end, 'COUNT', parseInt(limit));
      
      const formattedLogs = logs.map(([id, fields]) => {
        const logData: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          logData[fields[i]] = fields[i + 1];
        }
        
        return {
          id,
          timestamp: parseInt(logData.timestamp) || Date.now(),
          level: parseInt(logData.level) || 30,
          msg: logData.msg || '',
          runId: logData.runId || runId,
          source: logData.source || '',
          raw: logData.raw || ''
        };
      });

      return { logs: formattedLogs };
    } catch (error: any) {
      console.error('Error fetching logs:', error);
      reply.status(500);
      return { error: 'Failed to fetch logs' };
    }
  });

  // Clean up old logs (optional - can be called periodically)
  fastify.delete('/cleanup/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    
    if (!runId || typeof runId !== 'string') {
      reply.status(400);
      return { error: 'Invalid run ID' };
    }

    try {
      const streamKey = `logs:${runId}`;
      await redis.del(streamKey);
      return { message: 'Logs cleaned up successfully' };
    } catch (error: any) {
      console.error('Error cleaning up logs:', error);
      reply.status(500);
      return { error: 'Failed to clean up logs' };
    }
  });
};
