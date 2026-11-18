function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const PORTS = {
  caddy: envPort('CADDY_HOST_PORT', 18080),
  backend: envPort('BACKEND_HOST_PORT', 18081),
  frontend: envPort('FRONTEND_HOST_PORT', 15173),
};

export const ORIGIN = process.env.MEMRIES_E2E_ORIGIN || `http://localhost:${PORTS.caddy}`;
