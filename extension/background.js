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

import {log as logCore, getErrorDescription, debounce} from './lib/utils.js';

logCore.config({name: 'imo'});

/*
 * consts
 */

/** @type {boolean} */
const LOG_ENABLE = true;
/** @type {number} */
const WEBSOCKET_OPENED = 1;
/** @type {number} */
const KEEPALIVE_INTERVAL_SECS = 20;
/** @type {number} */
const INITIALIZE_DELAY_MSECS = 3000;

/*
 * variables
 */

/** @type {WebSocket} */
let websocket;
/** @type {boolean} */
let unexpectedDisconnectionDetected;
/** @type {number} */
let keepAliveTimer;
/** @type {object} */
let settings;
/** @type {number} */
let lastAudioPlayedTime = 0;
/** @type {Set} */
const tabIds = new Set;
/** @type {Function} */
const log = LOG_ENABLE ? logCore : () => {};

/*
 * functions
 */

/**
 * @returns {object}
 */
function getDefaultSettings () {
	return {
		enable: true,
		enableStyle: true,
		enableSpeech: true,
		enablePopup: true,

		port: 6631,
		volume: 0.5,
		speechIntervalSecs: 10,

		style: {
			borderColor: '#888',
			backgroundColor: '#edf8fc',
			color: '#006494',
		},
		coloredStates: [
			'ひらがな', 'カタカナ', '半角カタカナ',						// fcitx5 + Skk (ja)
			'Hiragana', 'Katakana', 'Half width Katakana',				// fcitx5 + Skk (en)

			'全角かな', '全角カナ', '半角カナ',							// fcitx5 + Mozc (ja)
			'Hiragana', 'Katakana', 'Half Katakana',					// fcitx5 + Mozc (en)

			'入力モード (あ)', '入力モード (ア)', '入力モード (_ｱ)',	// ibus + Mozc (ja)
			'Input Mode (あ)', 'Input Mode (ア)', 'Input Mode (_ｱ)'		// ibus + Mozc (en)
		],
		inputTypes: [
			'email', 'number', 'search', 'tel', 'text', 'url'
		],

		lines: {
			/*
			 * tested on
			 *   fcitx 5.0.14
			 *   IBUS 1.5.26
			 */
			'direct': [
				'en',				// fcitx5 + Skk
				'Direct',			// fcitx5 + Mozc
				'入力モード (A)',	// ibus + US keyboard (ja)
				'Input Mode (A)'	// ibus + US keyboard (en)
			],
			'alnum': [
				'英数',				// fcitx5 + Skk (ja)
				'Latin',			// fcitx5 + Skk (en)
				'半角英数',			// fcitx5 + Mozc (ja)
				'Half ASCII',		// fcitx5 + Mozc (en)
				'入力モード (_A)',	// ibus (ja)
				'Input Mode (_A)'	// ibus (en)
			],
			'alnum-wide': [
				'全角英数',			// fcitx5 + Skk (ja)
				'Wide latin',		// fcitx5 + Skk (en)
				'全角英数',			// fcitx5 + Mozc (ja)
				'Full ASCII',		// fcitx5 + Mozc (en)
				'入力モード (Ａ)',	// ibus (ja)
				'Input Mode (Ａ)'	// ibus (en)
			],
			'hiragana': [
				'ひらがな',			// fcitx5 + Skk (ja)
				'Hiragana',			// fcitx5 + Skk (en)
				'全角かな',			// fcitx5 + Mozc (ja)
				'Hiragana',			// fcitx5 + Mozc (en)
				'入力モード (あ)',	// ibus (ja)
				'Input Mode (あ)'	// ibus (en)
			],
			'katakana': [
				'カタカナ',			// fcitx5 + Skk (ja)
				'Katakana',			// fcitx5 + Skk (en)
				'全角カナ',			// fcitx5 + Mozc (ja)
				'Full Katakana',	// fcitx5 + Mozc (en)
				'入力モード (ア)',	// ibus (ja)
				'Input Mode (ア)'	// ibus (en)
			],
			'katakana-narrow': [
				'半角カタカナ',			// fcitx5 + Skk (ja)
				'Half width Katakana',	// fcitx5 + Skk (en)
				'半角カナ',				// fcitx5 + Mozc (ja)
				'Half Katakana',		// fcitx5 + Mozc (en)
				'入力モード (_ｱ)',		// ibus (ja)
				'Input Mode (_ｱ)'		// ibus (en)
			]
		}
	};
}

async function initApplication () {
	if (settings === undefined) {
		const s = await chrome.storage.local.get(getDefaultSettings());
		settings = s;
	}
	if (websocket === undefined) {
		await startConnect();
	}
}

function keepAlive () {
	if (keepAliveTimer) return;

	keepAliveTimer = setInterval(() => {
		if (websocket) {
			websocket.send('?');
		}
		else {
			clearInterval(keepAliveTimer);
			keepAliveTimer = undefined;
		}
	}, 1000 * KEEPALIVE_INTERVAL_SECS);
}

function updateActionIcon () {
	const extensionTitle = chrome.runtime.getManifest().name;
	let icon, tooltip;

	if (isConnected() && settings?.enable) {
		icon = {
			path: {
				'16': 'icon/icon016.png',
				'48': 'icon/icon048.png',
				'128': 'icon/icon128.png'
			}
		};
		tooltip = {
			title: `${extensionTitle}\nポート ${settings.port} で通信中です`
		};
	}
	else {
		icon = {
			path: {
				'16': 'icon/icon016-gray.png',
				'48': 'icon/icon048-gray.png',
				'128': 'icon/icon128-gray.png'
			}
		};
		tooltip = {
			title: isConnected() ?
				`${extensionTitle}\n停止しています` :
				`${extensionTitle}\nバックエンドに接続していません`
		};
	}

	return Promise.all([
		chrome.action.setIcon(icon),
		chrome.action.setTitle(tooltip)
	]);
}

/**
 * @param {any} message
 * @returns {Promise<[]>}
 */
function broadcastToClientTabs (message) {
	const broadcastPromises = [];
	tabIds.forEach(tabId => {
		broadcastPromises.push(chrome.tabs.sendMessage(tabId, message));
	});
	log(`broadcasting a message to tab #${[...tabIds].join(', #')}...`);
	return Promise.all(broadcastPromises);
}

/**
 * @returns {Promise<boolean>}
 */
function startConnect () {
	if (websocket) return Promise.resolve(isConnected());

	return new Promise(resolve => {
		function handleError (e) {
			try {
				log('websocket#onerror: error occured');
			}
			catch (err) {
				log(`websocket#onerror: ${getErrorDescription(err)}`);
			}
		}

		function handleOpen (e) {
			try {
				websocket.onmessage = async e => {
					try {
						if (e.data === '!') return;
						await handleInputMethodStateChange(JSON.parse(e.data));
					}
					catch (err) {
						log(`websocket#onmessage: ${getErrorDescription(err)}`);
					}
				};
				log('websocket#onopen: connected');

				keepAlive();
				updateActionIcon();
				resolve(true);
			}
			catch (err) {
				log(`websocket#onopen: ${getErrorDescription(err)}`);
			}
		}

		function handleClose (e) {
			try {
				websocket = undefined;
				log(`websocket#onclose: disconnected. code: ${e.code}, reason: "${e.reason}", wasClean: ${e.wasClean}`);

				unexpectedDisconnectionDetected = !e.wasClean;
				updateActionIcon();
				broadcastToClientTabs({type: 'invalidate-settings'});
			}
			catch (err) {
				log(`websocket#onclose: ${getErrorDescription(err)}`);
			}
		}

		websocket = new WebSocket(`ws://localhost:${settings.port}`);
		websocket.onerror = handleError;
		websocket.onopen = handleOpen;
		websocket.onclose = handleClose;
	});
}

/**
 * @returns {boolean}
 */
function isConnected () {
	return websocket?.readyState === WEBSOCKET_OPENED;
}

/*
 * event handlers
 */

const handleInitialize = debounce(async () => {
	try {
		log(`enter handleInitialize`);

		await initApplication();
	}
	catch (err) {
		log(`handleInitialize: exception, ${getErrorDescription(err)}`);
	}
}, INITIALIZE_DELAY_MSECS);

/**
 * @param {object} data
 */
async function handleInputMethodStateChange (data) {
	const window = await chrome.windows.getLastFocused();
	if (!window.focused) {
		return;
	}

	const tabs = await chrome.tabs.query({currentWindow: true, active: true});
	if (tabs.length === 0) {
		return;
	}

	log(`sending data ${JSON.stringify(data)} to ${tabs[0].id}#0 (${tabs[0].url.substring(0, 32)}...)`);
	try {
		await chrome.tabs.sendMessage(tabs[0].id, {
			connected: isConnected(),
			settings,
			data: {...data, lastAudioPlayedTime}
		});
	}
	catch {
		;
	}
}

/**
 * @param {object} newSettings
 */
async function handleUpdateSettings (newSettings) {
	// port updated: disconnect -> connect
	if ('port' in newSettings && newSettings.port !== settings.port) {
		if (websocket) {
			websocket.close();
			websocket = undefined;
		}
	}

	const updated = {};
	for (const name of Object.keys(settings)) {
		if (name in newSettings) {
			log(`new settings for "${name}", value: ${JSON.stringify(newSettings[name])}`);
			updated[name] = settings[name] = newSettings[name];
		}
	}

	//await chrome.storage.local.clear();
	await chrome.storage.local.set(updated);
	await startConnect();
	await broadcastToClientTabs({type: 'invalidate-settings'});
}

/*
 * bootstrap
 */

chrome.idle.onStateChanged.addListener(state => {
	log(`idle state changed: ${state}`);
	if (state === 'active' && unexpectedDisconnectionDetected) {
		// this computer might have resumed from suspend?
		unexpectedDisconnectionDetected = false;
		startConnect();
	}
});

chrome.runtime.onInstalled.addListener(() => {
	log('runtime.onInstlled');
	handleInitialize();
});

chrome.runtime.onStartup.addListener(() => {
	log('runtime.onStartup');
	handleInitialize();
});

chrome.tabs.onRemoved.addListener(tabId => {
	tabIds.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	switch (message.type) {
	case 'queryInternals':
		initApplication()
			.then(() => {
				sendResponse({
					settings,
					connected: isConnected()
				});
			})
			.catch(err => {
				log(`onMessage(${message.type}): ${getErrorDescription(err)}`);
				sendResonse({
					error: {
						message: err.message,
						stack: err.stack
					}
				});
			});
		return true;

	case 'updateSettings':
	case 'resetSettings':
		initApplication()
			.then(() => handleUpdateSettings(
				message.type === 'updateSettings' ?
					message.settings :
					getDefaultSettings()))
			.then(() => {
				sendResponse({
					settings,
					connected: isConnected()
				});
			})
			.catch(err => {
				log(`onMessage(${message.type}): ${getErrorDescription(err)}`);
				sendResonse({
					error: {
						message: err.message,
						stack: err.stack
					}
				});
			});
		return true;

	case 'notifyPlayAudio':
		lastAudioPlayedTime = Date.now();
		break;

	case 'notifyFocusIn':
		if (sender.tab) {
			log(`got focusin, ${sender.tab.id}#${sender.frameId} ${message.name} (${sender.tab.url.substring(0, 32)}...)`);
			initApplication();
			if (typeof sender.tab.id === 'number') {
				tabIds.add(sender.tab.id);
			}
		}
		break;

	case 'disconnect':
		websocket?.close();
		break;

	case 'log':
		log(message.log);
		break;
	}
});

log('*** Input Method Observer background service worker started ***');

// vim:set ts=4 sw=4 fenc=UTF-8 ff=unix ft=javascript fdm=marker fmr=<<<,>>> :
