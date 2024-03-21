#!/usr/bin/env -S node --preserve-symlinks
/*
 * Input Method Observer
 *
 * @author akahuku@gmail.com
 */
/**
 * Copyright 2024 akahuku, akahuku@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {default as nodePath} from 'node:path';
import * as util from 'node:util';

import WebSocket from 'ws';

/*
 * consts
 */

const DEFAULT_PORT = 6631;

/*
 * functions
 */

function startReceive (port) {
	const ws = new WebSocket(`ws://localhost:${port}`);

	ws.on('error', console.error);

	ws.on('open', () => {
		console.log('opened. press ^C to stop...');
	});

	ws.on('message', data => {
		console.log('received: %s', data);
	});
}

function printHelp () {
	const name = nodePath.basename(process.argv0);
	console.log(`\
${name} -- report input method status
usage: ${name} [options]
option:
  -p, --port    port number for websocket output mode. default port is ${DEFAULT_PORT}
`);
	process.exit(1);
}

function parseArgs () {
	try {
		const args = util.parseArgs({
			options: {
				'help':    {type: 'boolean', short: 'h'},
				'port':    {type: 'string',  short: 'p'},
				'?':       {type: 'boolean'}
			},
			strict: true
		});

		let port = DEFAULT_PORT;

		if (args.values.help || args.values['?']) {
			printHelp();
		}
		if (args.values.port) {
			if (!/^\d+$/.test(args.values.port)) {
				throw new Error(`Port must be a number: '${args.values.port}'`);
			}
			port = parseInt(args.values.port, 10);
		}
		return {port};
	}
	catch (err) {
		console.error(err.message);
		printHelp();
	}
}

/*
 * variables
 */

const args = parseArgs();

try {
	startReceive(args.port);
}
catch (err) {
	console.error(err.stack);
	process.exit(1);
}
