import pino from 'pino';

const logger = pino({
  redact: ['req.headers.authorization', 'req.body.apiKey', 'req.body.secret'],
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
      };
    },
  },
});

export function logRequest({ requestId, provider, latency, ...fields }: {
  requestId: string;
  provider: string;
  latency: number;
  [key: string]: any;
}) {
  logger.info({ requestId, provider, latency, ...fields });
}

export default logger;
