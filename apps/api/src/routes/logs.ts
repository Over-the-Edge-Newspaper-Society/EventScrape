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

    const streamKey = `logs:${runId}`;
    let lastId = '$'; // Start from the end

    // Function to send SSE message
    const sendEvent = (data: any, event = 'message') => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial connection event
    sendEvent({ type: 'connected', runId });

    // Read existing logs first
    try {
      const existingLogs = await redis.xrange(streamKey, '-', '+', 'COUNT', 100);
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
    } catch (error: any) {
      console.error('Error reading existing logs:', error);
    }

    // Set up interval to check for new logs
    const interval = setInterval(async () => {
      try {
        // Check if stream exists first
        const streamExists = await redis.exists(streamKey);
        if (!streamExists) {
          return; // Skip if stream doesn't exist yet
        }

        const newLogs = await redis.xread('STREAMS', streamKey, lastId, 'COUNT', 10);
        
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
        console.error('Error reading logs:', error);
      }
    }, 1000); // Check every second

    // Clean up on connection close
    request.raw.on('close', () => {
      clearInterval(interval);
      reply.raw.end();
    });

    request.raw.on('error', () => {
      clearInterval(interval);
      reply.raw.end();
    });
  });

  // Get historical logs for a run
  fastify.get('/history/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const { limit = '100', start = '-', end = '+' } = request.query as any;
    
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