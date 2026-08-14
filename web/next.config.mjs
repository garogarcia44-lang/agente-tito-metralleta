/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js en modo dev bloquea por defecto los recursos (_next/static/*) cuando
  // el Origin no coincide con localhost — protección normal contra otros sitios,
  // pero también bloquea el propio túnel de cloudflared, que es un origen
  // distinto (verificado en vivo: la página cargaba pero nada era interactivo,
  // ninguna pantalla con EventSource funcionaba). Comodín porque la URL del
  // túnel cambia cada vez que se reinicia — no se puede fijar la del momento.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
