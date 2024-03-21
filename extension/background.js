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

import {log} from './lib/utils.js';

log.config({name: 'imo'});

/*
 * consts
 */


/*
 * variables
 */

let p;
let websocket;
let keepAliveTimer;
let settings;
let lastAudioPlayedTime = 0;
const tabIds = new Set;
const focusedFrame = {};

/*
 * functions
 */

function registerInitializer () {
	return chrome.alarms.clearAll().then(wasCleared => {
		chrome.alarms.create('initializer', {
			when: Date.now() + 1000 * 3
		});
	});
}

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

function loadVars () {
	if (!p) {
		p = chrome.storage.local.get(getDefaultSettings()).then(s => {
			settings = s;
		});
	}

	return p;
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
	}, 1000 * 20);
}

function updateActionIcon () {
	const extensionTitle = chrome.runtime.getManifest().name;
	let icon, tooltip;

	if (websocket?.readyState === 1 && settings?.enable) {
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
			title: websocket?.readyState === 1 ?
				`${extensionTitle}\n停止しています` :
				`${extensionTitle}\nバックエンドに接続していません`
		};
	}

	return Promise.all([
		chrome.action.setIcon(icon),
		chrome.action.setTitle(tooltip)
	]);
}

function broadcastToClientTabs (message) {
	const broadcastPromises = [];
	tabIds.forEach(tabId => {
		log(`sending settings update message to tab #${tabId}`);
		broadcastPromises.push(chrome.tabs.sendMessage(tabId, message));
	});

	return Promise.all(broadcastPromises);
}

function startConnect () {
	if (websocket) return Promise.resolve(websocket.readyState === 1);

	return new Promise(resolve => {
		function handleError (e) {
			try {
				log('websocket#onerror: error occured');
			}
			catch (err) {
				log('websocket#onerror: ' + err.stack);
			}
		}

		function handleOpen (e) {
			try {
				websocket.onmessage = e => {handleMessageAsync(e)};
				keepAlive();
				log('websocket#onopen: connected');

				updateActionIcon();
				resolve(true);
			}
			catch (err) {
				log('websocket#onopen: ' + err.stack);
			}
		}

		function handleClose (e) {
			try {
				websocket = undefined;
				log(`websocket#onclose: disconnected`);

				updateActionIcon();
				broadcastToClientTabs({type: 'invalidate-settings'});
				resolve(false);
			}
			catch (err) {
				log('websocket#onclose: ' + err.stack);
			}
		}

		async function handleMessageAsync (e) {
			try {
				if (e.data === '!') return;
				await handleInputMethodStateChange(JSON.parse(e.data));
			}
			catch (err) {
				log('websocket#onmessage: ' + err.stack);
			}
		}

		websocket = new WebSocket(`ws://localhost:${settings.port}`);
		websocket.onerror = handleError;
		websocket.onopen = handleOpen;
		websocket.onclose = handleClose;
	});
}

/*
 * event handlers
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
		const result = await chrome.tabs.sendMessage(tabs[0].id, {
			data: {lastAudioPlayedTime, ...data}
		});
	}
	catch {
		;
	}
}

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

	await chrome.storage.local.clear();
	await chrome.storage.local.set(updated);
	await startConnect();
	await broadcastToClientTabs({type: 'invalidate-settings'});
}

/*
 * bootstrap
 */

chrome.runtime.onInstalled.addListener(() => {
	log('runtime.onInstlled');
	registerInitializer();
});

chrome.runtime.onStartup.addListener(() => {
	log('runtime.onStartup');
	registerInitializer();
});

chrome.alarms.onAlarm.addListener(alarm => {
	log(`alarms.onAlarm: ${alarm.name}`);
	switch (alarm.name) {
	case 'initializer':
		loadVars()
			.then(() => startConnect())
			.catch(err => {
				log(`onAlarm(initializer): ${err.stack}`);
			});
		break;
	}
});

chrome.tabs.onRemoved.addListener(tabId => {
	tabIds.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	switch (message.type) {
	case 'queryInternals':
		if (typeof sender.tab?.id === 'number') {
			tabIds.add(sender.tab.id);
			log(`got queryInternals, ${sender.tab.id}#${sender.frameId} ${message.name} (${sender.tab.url.substring(0, 32)}...)`);
		}
		loadVars()
			.then(() => {
				sendResponse({
					settings,
					connected: websocket?.readyState === 1
				});
			})
			.catch(err => {
				log(`onMessage(${message.type}): ${err.stack}`);
			});
		break;

	case 'updateSettings':
	case 'resetSettings':
		loadVars()
			.then(() => handleUpdateSettings(
				message.type === 'updateSettings' ?
					message.settings :
					getDefaultSettings()))
			.then(() => {
				sendResponse({
					settings,
					connected: websocket?.readyState === 1
				});
			})
			.catch(err => {
				log(`onMessage(${message.type}): ${err.stack}`);
			});
		break;

	case 'notifyPlayAudio':
		lastAudioPlayedTime = Date.now();
		break;

	case 'notifyFocusIn':
		if (sender.tab) {
			focusedFrame.tabId = sender.tab.id;
			focusedFrame.frameId = sender.frameId;
			//log(`got focusin, ${focusedFrame.tabId}#${focusedFrame.frameId} ${message.name} (${sender.tab.url.substring(0, 32)}...)`);
		}
		break;

	case 'log':
		log(message.log);
		break;
	}
	return true;
});

log('*** Input Method Observer background service worker started ***');

// vim:set ts=4 sw=4 fenc=UTF-8 ff=unix ft=javascript fdm=marker fmr=<<<,>>> :
