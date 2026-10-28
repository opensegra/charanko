import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { InumakiProgress } from 'inumaki';
import ffmpeg from 'ffmpeg-static';
import {
	BaseHttpClient,
	Charanko,
	DownloadException,
	InvalidDestinationException,
	KvsResolver,
	NotFoundException,
	PathBuilder
} from '../dist/index.mjs';

const root = mkdtempSync(join(tmpdir(), 'charanko-'));
const media = join(root, 'media');
const types = { '.mp4': 'video/mp4', '.ts': 'video/mp2t', '.m3u8': 'application/vnd.apple.mpegurl' };

let base = '';
let server;

// a quiet downloader writing into its own folder
const charanko = () => Charanko.create({ progress: new InumakiProgress('Test', { display: false }) });
const options = (name, extra = {}) => ({ outputType: 'DEVICE', directory: { directoryPath: join(root, name) }, retries: 1, ...extra });

before(async () => {
	execFileSync('mkdir', ['-p', join(media, 'hls')]);

	const source = ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'];

	execFileSync(ffmpeg, [...source, '-t', '2', join(media, 'clip.mp4')]);
	execFileSync(ffmpeg, [
		...source,
		'-t',
		'4',
		'-g',
		'10',
		'-f',
		'hls',
		'-hls_time',
		'1',
		'-hls_playlist_type',
		'vod',
		join(media, 'hls', 'index.m3u8')
	]);

	server = createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		const status = { '/forbidden.mp4': 403, '/missing.mp4': 404 }[url.pathname];

		if (status || (url.pathname === '/signed.mp4' && url.searchParams.get('token') !== 'fresh')) {
			response.writeHead(status ?? 403, { 'content-type': 'text/html' });
			return response.end('<html>blocked</html>');
		}

		const file = join(media, url.pathname === '/signed.mp4' ? 'clip.mp4' : url.pathname);

		if (!existsSync(file)) {
			response.writeHead(404);
			return response.end();
		}

		const body = readFileSync(file);

		response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'content-length': body.length });
		response.end(body);
	});

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	server.close();
	await BaseHttpClient.closeAgents();
});

test('downloads a file to disk through a .part file', async () => {
	const result = await charanko().download({ url: `${base}/clip.mp4`, folder: 'videos/1' }, options('file'));

	assert.equal(statSync(result.path).size, statSync(join(media, 'clip.mp4')).size);
	assert.match(result.path, /videos\/1\/clip\.mp4$/);
	assert.equal(existsSync(`${result.path}.part`), false);
});

test('stitches an HLS playlist and remuxes it to MP4', async () => {
	const result = await charanko().download({ url: `${base}/hls/index.m3u8` }, options('hls'));

	assert.equal(result.extension, 'mp4');
	assert.equal(result.mimeType, 'video/mp4');
	assert.ok(statSync(result.path).size > 1000);
	assert.deepEqual(readdirSync(join(root, 'hls')), [result.path.split('/').pop()]);
});

test('streams HLS as fragmented MP4 without touching the disk', async () => {
	const result = await charanko().download({ url: `${base}/hls/index.m3u8` }, { ...options('stream'), outputType: 'STREAM' });

	let bytes = 0;

	for await (const chunk of result.stream) bytes += chunk.length;

	assert.equal(result.mimeType, 'video/mp4');
	assert.ok(bytes > 1000);
	assert.equal(existsSync(join(root, 'stream')), false);
});

test('download keeps its instance when destructured', async () => {
	const { download } = charanko();
	const result = await download({ url: `${base}/clip.mp4` }, options('destructured'));

	assert.ok(statSync(result.path).size > 0);
});

test('a dry run reports the media without downloading it', async () => {
	const file = await charanko().download({ url: `${base}/clip.mp4`, folder: 'videos/1' }, options('dry', { dryRun: true }));
	const playlist = await charanko().download({ url: `${base}/hls/index.m3u8` }, options('dry', { dryRun: true }));

	assert.equal(file.sizeBytes, statSync(join(media, 'clip.mp4')).size);
	assert.equal(file.path, 'videos/1/clip.mp4');
	assert.equal(playlist.extension, 'ts');
	assert.equal(existsSync(join(root, 'dry')), false);
});

test('a 403 throws DownloadException and writes nothing', async () => {
	await assert.rejects(charanko().download({ url: `${base}/forbidden.mp4` }, options('forbidden')), (error) => {
		assert.ok(error instanceof DownloadException);
		assert.equal(error.code, 'ERR_DOWNLOAD_FAILED');
		assert.match(error.message, /server answered 403/);
		return true;
	});

	assert.equal(existsSync(join(root, 'forbidden')), false);
});

test('a 404 throws NotFoundException', async () => {
	await assert.rejects(charanko().download({ url: `${base}/missing.mp4` }, options('missing')), (error) => {
		assert.ok(error instanceof NotFoundException);
		assert.equal(error.code, 'ERR_NOT_FOUND');
		return true;
	});
});

test('an expired URL is refreshed once and then downloaded', async () => {
	let refreshes = 0;

	const result = await charanko().download(
		{ url: `${base}/signed.mp4?token=old` },
		options('refresh', {
			refresh: async (target) => {
				refreshes++;
				return { ...target, url: `${base}/signed.mp4?token=fresh` };
			}
		})
	);

	assert.equal(refreshes, 1);
	assert.match(result.finalUrl, /token=fresh/);
	assert.ok(statSync(result.path).size > 0);
});

test('paths outside the output directory are rejected', async () => {
	await assert.rejects(
		charanko().download({ url: `${base}/clip.mp4`, folder: '../../escape' }, options('escape')),
		InvalidDestinationException
	);
});

test('KVS function URLs are deciphered with the license code', () => {
	const url = 'function/0/https://example.com/get_file/1/abcdef0123456789abcdef0123456789rest/12000/12345/12345.mp4/';

	assert.equal(
		KvsResolver.resolve(url, '$536033614413519'),
		'https://example.com/get_file/1/27a2bdf8ce406573659819cdb31a4ef0rest/12000/12345/12345.mp4/'
	);
	assert.equal(KvsResolver.resolve(url), url);
	assert.equal(KvsResolver.resolve('https://example.com/a.mp4', '$1'), 'https://example.com/a.mp4');
});

test('folder names are made safe', () => {
	assert.equal(new PathBuilder().safeName('Jane Doe!'), 'Jane_Doe_');
	assert.equal(new PathBuilder().safeName(null), 'unknown');
});

test('CommonJS code can require it', () => {
	const require = createRequire(import.meta.url);
	const result = spawnSync(process.execPath, ['-e', "const { Charanko } = require('charanko'); console.log(typeof Charanko.create)"], {
		cwd: new URL('..', import.meta.url),
		encoding: 'utf8'
	});

	assert.equal(result.stdout.trim(), 'function', result.stderr);
	assert.equal(typeof require('../dist/index.js').Charanko, 'function');
});
