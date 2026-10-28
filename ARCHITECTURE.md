# Charanko Transport Architecture

## Workflow

### FOR HLS (HTTP LIVE STREAM)

### EXPLANATION

### SNI SPOOFING

1. **Primary Transport**: BaseHttpClient first attempts to download using configured primary undici agent with customized ciphers and ALPNProtocols.

2. **Hybrid Fallback (SNI Spoofing)**: If the primary transport fails with `ECONNRESET`, it catches the error and switches to a dedicated spoofAgent. This agent specifically tells the TLS socket to connect to `www.google.com` during the TLS handshake (which easily bypasses the ISP's SNI DPI filters).

3. **Because the HTTP Host header still correctly passes `de.eporner.com`, the Eporner or any other sites backend seamlessly processes the request and responds with a successful `HTTP 200 OK`**.

```
HLS always uses m3u8 playlists not direct video files.

Process:
1. CHECK THE CONTENT TYPE FOR application/vnd.apple.mpegurl OR THE URL ENDS WITH .m3u8 EXTENSION.

2. PARSE THE TEXT MANIFEST, SCAN FOR KEYWORDS:
   #EXT-X-STREAM-INF:BANDWIDTH=800000
   low.m3u8
   #EXT-X-STREAM-INF:BANDWIDTH=2000000
   high.m3u8

3. SELECT THE HLS VARIANT:
   (Two Types: MASTER PLAYLIST (qualities), MEDIA PLAYLIST (segments))
   3.1. Match by bandwidth (highest quality)
   3.2. Select media playlist URL.

4. DOWNLOAD EACH SEGMENT SEQUENTIALLY/CONCURRENTLY.
5. DECRYPT SEGMENT IF AES-128 IS ENABLED.
6. WRITE SEGMENT DATA DIRECTLY TO THE PROVIDED WRITABLE STREAM (Zero Memory Buffering).
```

### Flowchart

```
fetchToStream(url, opts, stream)
↓
Detect HLS (.m3u8)
↓
fetchHlsStream(manifest, url, timeout, stream)
↓
Parse master playlist & Select variant
↓
Fetch media playlist & Extract segment URLs
↓
For each segment:
    - Download segment buffer
    - Decrypt (AES-128-CBC) if key exists
    - Write to Writable stream
↓
Complete (Stream ownership stays with the caller)
```
