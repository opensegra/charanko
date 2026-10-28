<p align="center">
	<img src="public/icons/charanko.svg" alt="charanko" width="128" height="128">
</p>

# Charanko

`charanko` downloads media in Node: plain files and HLS streams, with host and CDN fallbacks, expired-URL refreshes, AES-128 decryption, KVS link deciphering and an FFmpeg remux into a playable MP4. It writes to disk, or hands back a readable stream you can pipe anywhere. Node.js 22.12 or newer is required, and it works from both ESM and CommonJS (`require`).

Charanko moves media; it doesn't find it. Pass it the URL of a file or playlist, and keep site scraping in your app.

## Install

```sh
npm install charanko

pnpm install charanko
```

FFmpeg comes bundled through `ffmpeg-static`. If your package manager blocks its install script (pnpm does by default), allow it, or point Charanko at your own binary with `transcode: { ffmpegPath: '/opt/homebrew/bin/ffmpeg' }`.

## Download

```ts
import { Charanko } from 'charanko';

const charanko = Charanko.create();

const result = await charanko.download(
	{ url: 'https://cdn.example.com/video/master.m3u8', referer: 'https://example.com/watch/42', folder: 'videos/42' },
	{ outputType: 'DEVICE', directory: { directoryPath: './downloads' }, quality: '720p' }
);

console.log(result.path, result.sizeBytes);
```

The first argument says what to download, the second says how:

| Target field | Meaning |
| --- | --- |
| `url` | Media URL: a file, an HLS master or media playlist, or a KVS `function/N/…` link |
| `referer` | Page the media came from, sent as the Referer |
| `folder` | Output folder inside the directory, such as `videos/42` |
| `licenseCode` | KVS license code from the page's `flashvars`, used to decipher `function/N/` URLs |

| Option | Meaning |
| --- | --- |
| `outputType` | `'DEVICE'` writes a file, `'STREAM'` returns a readable |
| `directory` | `{ directoryPath, prefix }`; files go to `./downloads` by default |
| `quality` | Preferred HLS variant, such as `'720p'`; the best one when left out |
| `transcode` | FFmpeg settings: `ffmpegPath`, `videoCodec`, `audioCodec`, `crf`, `preset`, `ffmpegArgs`, … |
| `headers`, `timeoutMs`, `retries`, `signal` | Request headers, a per-request timeout (30 s), retries (3) and an abort signal |
| `proxy`, `enableSniSpoofing`, `dispatcher` | Route requests through a proxy, an SNI-spoofing agent, or your own undici dispatcher |
| `refresh` | Called with the target when its URL expired; return a fresh target |
| `dryRun` | Resolve the media and return its details without downloading or writing anything |

`download` is bound to its instance, so `const { download } = Charanko.create()` works too.

## Output

**To disk** (`'DEVICE'`). Bytes land in a `.part` file that is renamed only when the transfer finishes, so an interrupted download never looks complete. HLS segments are stitched in order, and MPEG-TS or fragmented MP4 is remuxed with `ffmpeg -c copy` into an MP4 with `+faststart`.

**As a stream** (`'STREAM'`). `download` resolves as soon as the response is open, and `result.stream` carries the media while it downloads. Pipe it to an HTTP response or object storage right away, or destroy it; leaving it unread stalls the transfer. Transport streams are remuxed on the fly into fragmented MP4, so `sizeBytes` is only exact when nothing was remuxed; use `estimatedBytes` for progress.

```ts
const { stream, mimeType } = await charanko.download({ url }, { outputType: 'STREAM' });

reply.header('content-type', mimeType);
stream.pipe(reply.raw);
```

## HLS

Charanko picks the variant closest to `quality` (falling back to bandwidth when a playlist lists no resolution), fetches the next segment while the current one streams, decrypts AES-128 segments with per-segment keys and IVs, and writes the `EXT-X-MAP` init segment first for fMP4. Live playlists and SAMPLE-AES are not supported. [ARCHITECTURE.md](ARCHITECTURE.md) walks through the HLS flow and the SNI-spoofing transport fallback.

## Expired URLs and site rules

Signed media URLs expire. When a request fails with a status your strategy marks as expired (403 and 410 by default), Charanko calls `refresh(target)` once and retries with what it returns:

```ts
await charanko.download(target, {
	outputType: 'DEVICE',
	refresh: async (expired) => ({ ...expired, url: await extractFreshUrl(expired.referer) })
});
```

Anything else that depends on the site goes in a `TransferStrategy`:

```ts
import { Charanko, TransferStrategy } from 'charanko';

class MySiteStrategy extends TransferStrategy {
	candidateUrls(url: string) {
		return super.candidateUrls(url, ['cdn1.mysite.com', 'cdn2.mysite.com']); // try these hosts in order
	}

	shouldResolveTextResponse(url: string, contentType: string) {
		return contentType.includes('application/json'); // the response names the real media URL
	}

	mediaUrlFromText(body: string) {
		return JSON.parse(body).src;
	}
}

const charanko = Charanko.create({ strategy: new MySiteStrategy() });
```

| Method | Default | Use it to |
| --- | --- | --- |
| `candidateUrls(url, hosts)` | the URL alone | try the same path on other hosts |
| `shouldFallbackOnNotFound(url)` / `fallbackUrl(url)` | off | swap to another CDN after a 404 |
| `shouldRefresh(url, status)` | 403 and 410 | decide which failures mean "expired" |
| `shouldResolveTextResponse(url, contentType)` / `mediaUrlFromText(body)` | off | follow a text or JSON response to the media |

## Errors

Every failure is thrown, never written to disk:

| Exception | `code` | When |
| --- | --- | --- |
| `NotFoundException` | `ERR_NOT_FOUND` | 404 after every fallback and refresh |
| `DownloadException` | `ERR_DOWNLOAD_FAILED` | Any other status, or a network error after every retry |
| `InvalidDestinationException` | `ERR_INVALID_DESTINATION` | The output path is a URI, escapes its directory, or can't be created |

Each one carries the URL or path in `context` and the underlying error as `cause`. 429 and 5xx responses are retried with backoff first; other failures cost a single request.

## Progress

Charanko reports through [`inumaki`](https://www.npmjs.com/package/inumaki): a live panel in a terminal, one summary line when piped. Pass your own progress to theme it, follow its updates, or keep a server quiet:

```ts
import { InumakiProgress } from 'inumaki';

const progress = new InumakiProgress('Download', { display: false });

progress.on('update', (snapshot) => console.log(snapshot.bytes, snapshot.speed));

const charanko = Charanko.create({ progress });
```

Each `Charanko.create()` builds its own clients and progress, so parallel downloads stay separate; HTTP connection pools are shared across the process. Call `BaseHttpClient.closeAgents()` when a long-lived process is done downloading.

## Building blocks

`Charanko.create()` wires everything for you. To assemble it yourself, the parts are exported from the root and from subpaths: `charanko/client` (`StreamHttpClient`, `HlsClient`), `charanko/storage` (`FileManager`, `FFmpegEngine`, `PathBuilder`), `charanko/utils` (`KvsResolver`, quality helpers), `charanko/contracts` and `charanko/types`.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint:test
pnpm test   # builds, then downloads from a local server: files, HLS, refreshes, errors and streams
```
