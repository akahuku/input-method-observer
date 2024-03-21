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

import child_process from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import {default as nodePath} from 'node:path';
import * as util from 'node:util';

import dbus from 'dbus-next';
import WebSocket, {WebSocketServer} from 'ws';

import {debounce, parseJson, } from './utils.js';

/*
MONITOR DBUS SIGNALS (ibus):

$ dbus-monitor --address $(ibus address) "type='signal',path='/org/freedesktop/IBus',interface='org.freedesktop.IBus'"
*/

/*
INVESTIGATE DBUS SERVICE NAMES (ibus):

$ dbus-send --bus=$(ibus address) --print-reply --type=method_call \
  --dest=org.freedesktop.DBus \
  /org/freedesktop/DBus \
  org.freedesktop.DBus.ListNames

output:
method return time=1710321846.022598 sender=org.freedesktop.DBus -> destination=:1.36 serial=2 reply_serial=2
   array [
      string "org.freedesktop.DBus"
      string "org.freedesktop.IBus"
      string "org.freedesktop.IBus.Panel.Extension.Emoji"
      string "org.freedesktop.IBus.Panel"
      string "org.freedesktop.IBus.Config"
      string "org.freedesktop.IBus.Simple"
      string "com.google.IBus.Mozc"
      string ":1.3"
      string ":1.4"
      string ":1.16"
      string ":1.5"
      string ":1.36"
      string ":1.6"
      string ":1.7"
      string ":1.1"
      string ":1.8"
      string ":1.2"
      string ":1.9"
   ]
*/

/*
INTROSPECT INTERFACES (ibus):

$ dbus-send --bus=$(ibus address) --print-reply --type=method_call \
  --dest=org.freedesktop.IBus.Panel \
  /org/freedesktop/IBus/Panel \
  org.freedesktop.DBus.Introspectable.Introspect

output:
<node>
  :
  :
  <interface name="com.canonical.IBus.Panel.Private">
    <method name="ActivateProperty">
      <arg type="s" name="name" direction="in">
      </arg>
      <arg type="u" name="state" direction="in">
      </arg>
    </method>
    <signal name="PropertiesRegistered">
      <arg type="v" name="properties">
      </arg>
    </signal>
    <signal name="PropertyUpdated">
      <arg type="v" name="property">
      </arg>
    </signal>
  </interface>
</node>
*/

/*
MONITOR DBUS SIGNALS (fcitx):

$ dbus-monitor --session "type='signal',path='/kimpanel',interface='org.kde.kimpanel.inputmethod'"

'UpdateProperty' output:
signal time=1710057180.783007 sender=:1.94 -> destination=(null destination) serial=177545 path=/kimpanel; interface=org.kde.kimpanel.inputmethod; member=UpdateProperty
   string "/Fcitx/im:Skk:fcitx-skk:英数:menu,label=A_"

'Enable' output:
signal time=1710057180.783045 sender=:1.94 -> destination=(null destination) serial=177546 path=/kimpanel; interface=org.kde.kimpanel.inputmethod; member=Enable
   boolean true
*/

/*
 * consts
 */

const IBUS_DBUS_NAME = 'org.freedesktop.IBus';
const IBUS_DBUS_PATH = '/org/freedesktop/IBus';
const IBUS_DBUS_INTERFACE = 'org.freedesktop.IBus';

const IBUS_PANEL_DBUS_NAME = 'org.freedesktop.IBus.Panel';
const IBUS_PANEL_DBUS_PATH = '/org/freedesktop/IBus/Panel';
const IBUS_PANEL_DBUS_INTERFACE = 'com.canonical.IBus.Panel.Private';

const FCITX_DBUS_NAME = 'org.kde.kimpanel.inputmethod';
const FCITX_DBUS_PATH = '/kimpanel';
const FCITX_DBUS_INTERFACE = 'org.kde.kimpanel.inputmethod';

const NATIVE_MESSAGE_HEADER_LENGTH = 4;
const DEFAULT_PORT = 6631;
const MESSAGE_SEND_DELAY_MS = 50;
const CURRENT_LOG_FILE_NAME = 'imo-current.txt';

/*
 * classes
 */

class InputMethodObserver {
	bus;

	async init () {
	}

	disconnect () {
		if (this.bus) {
			console.log('disconnecting bus...');
			this.bus.disconnect();
			this.bus = undefined;
		}
	}
}

class IBusObserver extends InputMethodObserver {
	ibusObj;
	ibusIface;
	ibusProperties;
	panelObj;
	panelIface;

	async init () {
		// retrieve bus
		const busAddress = (await exec('ibus address'))
			.stdout.toString().replace(/\n$/, '');
		console.log(`bus address: "${busAddress}"`);
		this.bus = dbus.sessionBus({busAddress});

		// retrieve ibus interface, and watch signal
		this.ibusObj = await this.bus.getProxyObject(IBUS_DBUS_NAME, IBUS_DBUS_PATH);
		this.ibusIface = this.ibusObj.getInterface(IBUS_DBUS_INTERFACE);
		this.ibusProperties = this.ibusObj.getInterface('org.freedesktop.DBus.Properties');
		this.ibusIface.on('GlobalEngineChanged', engine_name => {
			// do nothing here. see generic message handler
		});

		// retrieve current global engine
		message.keyboard = await this.getGlobalEngineName();
		console.log(`globalEngine: "${message.keyboard}"`);

		// retrieve panel interface, and watch signal
		this.panelObj = await this.bus.getProxyObject(IBUS_PANEL_DBUS_NAME, IBUS_PANEL_DBUS_PATH);
		this.panelIface = this.panelObj.getInterface(IBUS_PANEL_DBUS_INTERFACE);
		this.panelIface.on('PropertyUpdated', property => {
			try {
				this.handleUpdateProperty(property);
			}
			catch (err) {
				console.error(err.message);
			}
		});

		/*
		 * note: It appears that the dsus-next library sometimes fails to
		 *       receive signals correctly.  Therefore, use a generic
		 *       message handler directly.
		 */

		this.bus.on('message', message => {
			try {
				if (message.type      === 4 /*SIGNAL*/
				 && message.sender    === IBUS_DBUS_NAME
				 && message.path      === IBUS_DBUS_PATH
				 && message.interface === IBUS_DBUS_INTERFACE
				 && message.member    === 'GlobalEngineChanged') {
					this.handleGlobalEngineChanged(message.body[0]);
				}
			}
			catch (err) {
				console.error(err.message);
			}
		});
	}

	async getGlobalEngineName () {
		/*
		 * globalEngine(mozc):                                                   globalEngine(US keyboard):
		 * [                                                                     [
		 *                   0: "IBusEngineDesc"                                   0: "IBusEngineDesc"
		 *                   1: {}                                                 1: {}
		 *             name: 2: "mozc-jp"                                          2: "xkb:us::eng"
		 *         longname: 3: "Mozc"                                             3: "English (US)"
		 *      description: 4: "Mozc (Japanese Input Method)"                     4: "English (US)"
		 *         language: 5: "ja"                                               5: "en"
		 *          license: 6: ""                                                 6: "GPL"
		 *           author: 7: ""                                                 7: "Peng Huang <shawn.p.huang@gmail.com>"
		 *             icon: 8: "/usr/share/ibus-mozc/product_icon.png"            8: "ibus-keyboard"
		 *           layout: 9: "default"                                          9: "us"
		 *   layout_variant: 10: 80                                                10: 50
		 *    layout_option: 11: ""                                                11: ""
		 *             rank: 12: "あ"                                              12: ""
		 *          hotkeys: 13: "mozc_tool --mode=config_dialog"                  13: ""
		 *           symbol: 14: ""                                                14: ""
		 *            setup: 15: ""                                                15: ""
		 *          version: 16: ""                                                16: ""
		 *       textdomain: 17: ""                                                17: ""
		 *    icon_prop_key: 18: "InputMode"                                       18: ""
		 * ]                                                                     ]
		 */
		const globalEngine = await this.ibusProperties.Get(IBUS_DBUS_INTERFACE, 'GlobalEngine');
		return globalEngine.value.value[3];
	}

	handleUpdateProperty (property) {
		//console.log(`*** handleUpdateProperty ***`);
		//dumpDBusValue(property);
		requestOutputMessage({
			enable: true,
			text: property.value[4].value[2],
			extra: {
				label: property.value[11].value[2]
			}
		});
	}

	async handleGlobalEngineChanged (engine_name) {
		//console.log(`*** handleGlobalEngineChanged ***`);
		//dumpDBusValue(engine_name);
		const globalEngine = await this.getGlobalEngineName();
		requestOutputMessage({
			enable: true,
			label: globalEngine
		});
	}
}

class FcitxObserver extends InputMethodObserver {
	obj;
	iface;

	async init () {
		this.bus = dbus.sessionBus();
		this.obj = await this.bus.getProxyObject(FCITX_DBUS_NAME, FCITX_DBUS_PATH);
		this.iface = this.obj.getInterface(FCITX_DBUS_INTERFACE);

		this.iface.on('UpdateProperty', value => {
			try {
				this.handleUpdateProperty(value);
			}
			catch (err) {
				console.error(err.message);
			}
		});

		this.iface.on('Enable', value => {
			try {
				this.handleEnable(value);
			}
			catch (err) {
				console.error(err.message);
			}
		});
	}

	handleUpdateProperty (property) {
		requestOutputMessage(this.parseFcitxProperty(property));
	}

	handleEnable (enable) {
		requestOutputMessage({enable});
	}

	parseFcitxExtraData (p) {
		const result = {};
		p.split(',').forEach(data => {
			if (/^([^=]+)=(.*)$/.test(data)) {
				const key = RegExp.$1;
				const value = RegExp.$2;
				result[key] = value;
			}
			else {
				result[data] = null;
			}
		});
		return result;
	}

	parseFcitxProperty (p) {
		const result = {};
		p = p.split(':');
		result.key = p[0];
		result.label = p[1];
		result.icon = p[2];
		result.text = p[3];
		result.extra = p.length >= 5 && p[4].length ?
			this.parseFcitxExtraData(p[4]) : {};
		return result;
	}
}

/*
 * functions
 */

const exec = util.promisify(child_process.exec);

const outputDebounced = debounce(message => {
	outputFn(message);
	outputLog(message);
}, MESSAGE_SEND_DELAY_MS);

const processExitDebounced = debounce(exitCode => {
	if (exitCode >= 0) {
		inputMethodObserver.disconnect();
		process.exit(exitCode);
	}
}, 1000 * 30);

function now () {
	const d = new Date;
	return `00${d.getHours()}`.substr(-2) + ':' +
		`00${d.getMinutes()}`.substr(-2) + ':' +
		`00${d.getSeconds()}`.substr(-2) + ' ';
}

function dumpDBusValue (v, depth = 0, key = '') {
	if (v instanceof dbus.Variant) {
		dumpDBusValue(v.value, depth, key);
		return;
	}

	if ('' + key != '') {
		key += ': ';
	}
	if (Array.isArray(v)) {
		if (v.length) {
			console.log(`${' '.repeat(depth * 2)}${key}[`);
			for (const [index, subv] of v.entries()) {
				dumpDBusValue(subv, depth + 1, index);
			}
			console.log(`${' '.repeat(depth * 2)}]`);
		}
		else {
			console.log(`${' '.repeat(depth * 2)}${key}[]`);
		}
	}
	else if (typeof v === 'object') {
		if (Object.keys(v).length) {
			console.log(`${' '.repeat(depth * 2)}${key}{`);
			for (const [key, subv] of Object.entries(v)) {
				dumpDBusValue(subv, depth + 1, key);
			}
			console.log(`${' '.repeat(depth * 2)}}`);
		}
		else {
			console.log(`${' '.repeat(depth * 2)}${key}{}`);
		}
	}
	else if (typeof v === 'string') {
		console.log(`${' '.repeat(depth * 2)}${key}"${v}"`);
	}
	else {
		console.log(`${' '.repeat(depth * 2)}${key}${v}`);
	}
}

function requestOutputMessage (p) {
	if ('enable' in p) {
		message.enable = p.enable;
	}
	if ('label' in p && p.label.length) {
		message.keyboard = p.label;
	}
	if ('extra' in p && 'label' in p.extra && p.extra.label.length) {
		message.shortState = message.longState = p.extra.label;
	}
	if ('text' in p && p.text.length) {
		message.longState = p.text;
	}

	outputDebounced(message);
}

/*
 * @see https://gist.github.com/jeremyben/46ad0422dd0e925efd879324efa3f02f#file-socket-handle-ts
 *
 * Returns file descriptor of systemd socket.
 * Returns `undefined` if the process has not been activated by systemd socket.
 */
function getSystemdSocketHandle () {
	// https://www.freedesktop.org/software/systemd/man/sd_listen_fds.html
	const SD_LISTEN_FDS_START = 3;

	const LISTEN_PID = !!process.env.LISTEN_PID && Number.parseInt(process.env.LISTEN_PID);
	const LISTEN_FDS = !!process.env.LISTEN_FDS && Number.parseInt(process.env.LISTEN_FDS);
	const LISTEN_FDNAMES = !!process.env.LISTEN_FDNAMES && process.env.LISTEN_FDNAMES.split(':');

	// console.log('PID:', process.pid, 'PPID:', process.ppid)
	// console.log('LISTEN_PID:', LISTEN_PID, 'LISTEN_FDS:', LISTEN_FDS, 'LISTEN_FDNAMES:', LISTEN_FDNAMES)

	const isSocketActivated = !!LISTEN_PID && !!LISTEN_FDS;

	if (!isSocketActivated) {
		return undefined;
	}

	if (LISTEN_PID !== process.pid) {
		throw Error(`Cannot use file descriptors meant for pid ${LISTEN_PID} in pid ${process.pid}`);
	}

	if (LISTEN_FDS > 1) {
		throw Error(`One file descriptor expected. ${LISTEN_FDS} received (${LISTEN_FDNAMES})`);
	}

	return { fd: SD_LISTEN_FDS_START };
}

async function startInputMethodObserver (imName) {
	if (imName === '') {
		const xinputrc = await fs.readFile(
			nodePath.join(os.homedir(), '.xinputrc'),
			{encoding: 'utf8'});
		if (/run_im\s+(.+)/.test(xinputrc)) {
			imName = RegExp.$1;
		}
	}

	switch (imName) {
	case 'ibus':
		inputMethodObserver = new IBusObserver;
		break;

	case 'fcitx':
	case 'fcitx5':
		inputMethodObserver = new FcitxObserver;
		break;

	default:
		console.error(`Unsupported input method: "${imName}"`);
		process.exit(1);
	}

	try {
		await inputMethodObserver.init();
	}
	catch (err) {
		throw new Error(`failed to initialize the ${imName} observer.`);
	}
}

function startOutput (mode, port, verbose) {
	function startStdoutMode () {
		outputFn = message => {
			console.log(now() + JSON.stringify(message, null, '\t'));
		};

		console.log('press ^C to stop...');
	}

	function startNativeMessageMode () {
		function readFromStdin () {
			let chunks = [], chunk;
			while ((chunk = process.stdin.read())) {
				chunks.push(chunk);
			}
			return Buffer.concat(chunks);
		}

		outputFn = message => {
			const body = Buffer.from(JSON.stringify(message));
			const header = Buffer.alloc(NATIVE_MESSAGE_HEADER_LENGTH);
			header.writeUInt32LE(body.length, 0);
			process.stdout.write(Buffer.concat([header, body]))
		};

		process.stdin.on('readable', () => {
			try {
				const data = readFromStdin();
				const expectedDataLength = data.readUInt32LE(0) + NATIVE_MESSAGE_HEADER_LENGTH;
				if (data.length >= expectedDataLength) {
					const message = parseJson(data.slice(
						NATIVE_MESSAGE_HEADER_LENGTH,
						expectedDataLength).toString());

					if (process.stdout.isTTY || verbose) {
						console.log(`${now()} *** got a message *** `);
						console.dir(message);
					}

					// TBD: do something
				}
			}
			catch (err) {
				console.error(err.message);
			}
		});

		console.log('starting NativeMessaging mode...');
	}

	function startWebsocketMode () {
		const server = http.createServer();
		const wss = new WebSocketServer({server});

		server.listen(getSystemdSocketHandle() ?? port);

		outputFn = message => {
			if (process.stdout.isTTY || verbose) {
				console.log(`${now()}sending data to ${wss.clients.size} clients`);
			}

			const messageString = JSON.stringify(message);
			wss.clients.forEach(client => {
				if (client.readyState === WebSocket.OPEN) {
					client.send(messageString);
				}
			});
		};

		wss.on('connection', (ws, req) => {
			processExitDebounced(-1);

			ws.on('error', err => {
				process.stderr.write(now());
				console.error(err);
			});

			ws.on('close', () => {
				if (process.stdout.isTTY || verbose) {
					console.log(`${now()}closed`);
				}
				if (wss.clients.size === 0) {
					if (process.stdout.isTTY || verbose) {
						console.log(`${now()}there are no websocket clients`);
						console.log(`${now()}shutting down...`);
					}
					processExitDebounced(0);
				}
			});

			ws.on('message', data => {
				if (data.toString() === '?') {
					ws.send('!');
				}
				else {
					if (process.stdout.isTTY || verbose) {
						console.log(`${now()}received: ${data}`);
					}
				}
			});

			if (process.stdout.isTTY || verbose) {
				console.log(`${now()}connected from ${req.socket.remoteAddress}`);
			}
		});

		console.log(`waiting WebSocket connection on process #${process.pid}...`);
	}
	
	switch (mode) {
	case 'stdout':
		startStdoutMode();
		break;

	case 'native-message':
		startNativeMessageMode();
		break;

	case 'websocket':
		startWebsocketMode();
		break;

	default:
		console.error(`Unsupported output mode: "${mode}"`);
		process.exit(1);
	}
}

function printHelp () {
	const name = nodePath.basename(process.argv0);
	console.log(`\
${name} -- report input method status
usage: ${name} [options]
option:
  -i, --im-name input method name. one of:
                'ibus'
                'fcitx'
                if not specified this switch, detected automatically.
  -m, --mode    output mode. one of:
                'stdout' (default)
                'native-message'
                'websocket'
  -p, --port    port number for websocket output mode. default port is ${DEFAULT_PORT}
`);
	process.exit(1);
}

function parseArgs () {
	try {
		const args = util.parseArgs({
			options: {
				'help':    {type: 'boolean', short: 'h'},
				'im-name': {type: 'string',  short: 'i'},
				'mode':    {type: 'string',  short: 'm'},
				'port':    {type: 'string',  short: 'p'},
				'verbose': {type: 'boolean', short: 'v'},
				'?':       {type: 'boolean'}
			},
			strict: true
		});

		let outputModeName = 'stdout';
		let imName = '';
		let port = DEFAULT_PORT;

		if (args.values.help || args.values['?']) {
			printHelp();
		}
		if (args.values.mode) {
			switch (args.values.mode) {
			case 'stdout':
				outputModeName = 'stdout';
				break;
			case 'native-message':
			case 'nativemessage':
				outputModeName = 'native-message';
				break;
			case 'websocket':
			case 'ws':
				outputModeName = 'websocket';
				break;
			default:
				throw new Error(`Unknown output mode '${args.values.mode}'`);
			}
		}
		if (args.values['im-name']) {
			switch (args.values['im-name']) {
			case 'ibus':
			case 'fcitx':
				imName = args.values['im-name'];
				break;
			default:
				throw new Error(`Unknown im name '${args.values['im-name']}'`);
			}
		}
		if (args.values.port) {
			if (!/^\d+$/.test(args.values.port)) {
				throw new Error(`Port must be a number: '${args.values.port}'`);
			}
			port = parseInt(args.values.port, 10);
		}
		return {
			outputModeName, imName, port,
			verbose: args.values.verbose
		};
	}
	catch (err) {
		console.error(err.message);
		printHelp();
	}
}

function fileExists (filepath, mode) {
	let result = true;
	try {
		fs.accessSync(filepath, mode || fs.constants.R_OK);
	}
	catch {
		result = false;
	}
	return result;
}

async function outputLog (message) {
	let handle;
	try {
		const fileName = nodePath.join(os.tmpdir(), CURRENT_LOG_FILE_NAME);
		handle = await fs.open(fileName, 'w+');
		const {bytesWritten} = await handle.write(message.shortState, 0);
		await handle.truncate(bytesWritten);
	}
	catch (err) {
		console.error(err.stack);
	}
	finally {
		await handle?.close();
	}
}

/*
 * variables
 */

const args = parseArgs();
const message = {
	enable: undefined,
	keyboard: undefined,
	shortState: undefined,
	longState: undefined
};
let inputMethodObserver;
let outputFn = () => {};

try {
	await startInputMethodObserver(args.imName);
	startOutput(args.outputModeName, args.port, args.verbose);
}
catch (err) {
	if (args.verbose) {
		console.error(err.stack);
	}
	else {
		console.error(err.message);
	}
	process.exit(1);
}
