const FETCH_MARKER = "__tessarynCompressedCinematicFetchV1";
const scope = globalThis as typeof globalThis & Record<string, unknown>;

if (!scope[FETCH_MARKER]) {
  scope[FETCH_MARKER] = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await nativeFetch(...args);
    const input = args[0];
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, globalThis.location?.href ?? "http://localhost/");
    if (!url.pathname.endsWith(".tessaryn.gz") || !response.ok) return response;
    if (!response.body) throw new Error("compressed cinematic object response has no body");
    if (!("DecompressionStream" in globalThis)) {
      throw new Error("this browser cannot open gzip-compressed cinematic objects");
    }

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("content-type", "application/vnd.tessaryn.object");
    const body = response.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
