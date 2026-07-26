export function redirectResponse(location: string | URL, status = 303): Response {
  return new Response(null, {
    status,
    headers: {
      Location: location.toString(),
    },
  });
}
