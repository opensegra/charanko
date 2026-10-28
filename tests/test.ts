import { Charanko } from '../src';

async function main() {
	try {
		const { download } = Charanko.create();
		await download(
			{
				url: 'https://www.momvids.com/get_file/1/85d633e7651898217a9edafe6fbd375b/63000/63349/63349_720p.mp4/?v-acctoken=MTIzOHw1NjJ8MHw0ZjUzOGViNzcyNWIyNDI5ZDQwYmM1NTg4ZmIzM2U5MAec290731cec07060'
			},
			{
				outputType: 'DEVICE',
				referer:
					'https://www.momvids.com/videos/63349/vvbeautiful-blonde-aunt-in-hotel/?utm_source=PBWeb&utm_medium=PBWeb&sub=100001'
			}
		);
	} catch (error) {
		console.error(error);
	}
}

main();

// "mp4": [
//   {
//     "url": "https://www.momvids.com/get_file/1/72ef7b1c4ad5f726d64a754f7f2ccee3/63000/63349/63349.mp4/?v-acctoken=NzA0fDU2MnwwfDZmNDM3YzNlODFmODNhYzRhNjgwNTY3NGFjNTc1MGM31d43699e830063c8",
//     "quality": "480p"
//   },
//   {
//     "url": "https://www.momvids.com/get_file/1/85d633e7651898217a9edafe6fbd375b/63000/63349/63349_720p.mp4/?v-acctoken=MTIzOHw1NjJ8MHw0ZjUzOGViNzcyNWIyNDI5ZDQwYmM1NTg4ZmIzM2U5MA97035e6ab903417e",
//     "quality": "720p"
//   }
// ]
//  "hls": [
//   {
//     "url": "https://ok.porn/get_file/13/1c01b07ffea55b8bbe57cbc3735bc77b/742000/742207/742207_360p.mp4/",
//     "quality": "360p"
//   },
//   {
//     "url": "https://ok.porn/get_file/13/354486a0fd176cca2fe3b057b78911c3/742000/742207/742207.mp4/",
//     "quality": "unknown"
//   },
//   {
//     "url": "https://ok.porn/get_file/13/061581484becee136918d87b4345895d/742000/742207/742207_720p.mp4/",
//     "quality": "720p"
//   }
// ]
