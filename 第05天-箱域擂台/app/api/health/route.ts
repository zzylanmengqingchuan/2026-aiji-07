export function GET() {
  return Response.json({
    ok: true,
    service: "box-arcade",
    version: "4.0.0",
  });
}
