/** Health check endpoint - verifies the frontend worker is running */

interface Env {
  // Cloudflare bindings will go here (KV, D1, Durable Objects, etc.)
}

export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "escape-velocity-frontend",
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
};
