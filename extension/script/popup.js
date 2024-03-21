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

import {log, $, $qs, $qsa, empty, getReadableSize, debounce} from '../lib/utils.js';

log.config({name: 'imo'});

function updateIcon (internals) {
	const mainIcon = $('main-icon');
	if (internals.connected) {
		mainIcon.src = 'icon/icon048.png';
	}
	else {
		mainIcon.src = 'icon/icon048-gray.png';
	}
}

function updateMainContainer (internals) {
	const running = internals.connected && internals.settings.enable;
	$('enable').checked = running;
	$qsa('.options-container input[type="checkbox"]').forEach(el => {
		el.disabled = !running;
		el.checked = internals.settings[el.dataset.key];
	});
}

function setCheckboxState (enabled) {
	$qsa('input[type="checkbox"]').forEach(el => {
		el.disabled = !enabled;
	});
}

function handleOptionLinkClick (e) {
	e.preventDefault();
	chrome.runtime.openOptionsPage();
}

function handleCheckboxClick (e) {
	const checkbox = e.target.closest('input[type="checkbox"]');
	if (checkbox) {
		(async function () {
			try {
				let internals;

				setCheckboxState(false);
				try {
					internals = await chrome.runtime.sendMessage({
						type: 'updateSettings',
						settings: {
							[checkbox.dataset.key]: checkbox.checked
						}
					});
				}
				finally {
					setCheckboxState(true);
				}
				
				if (internals) {
					updateIcon(internals);
					updateMainContainer(internals);

					if (!internals.connected) {
						alert([
							'バックエンドに接続できません。',
							'',
							'・systemd のソケットユニットが停止中ではありませんか？',
							'・バックエンドプログラムが正しくインストールされていますか？',
							'・ポートの指定は正しいですか？'
						].join('\n'));
					}
				}
			}
			catch (err) {
				log(`popup#handleCheckboxClick: ${err.stack}`);
			}
		})();
	}
}

async function handleMessage (message) {
	log(`popup: got "${message.type}" message`);
}

Promise.all([
	chrome.runtime.sendMessage({type: 'queryInternals'}),
	new Promise(resolve => {
		if (/^(?:complete|interactive)$/.test(document.readyState)) {
			resolve();
		}
		else {
			document.addEventListener('DOMContentLoaded', resolve, {once: true});
		}
	})
]).then(([internals, e]) => {
	const manifest = chrome.runtime.getManifest();
	$('product').textContent = manifest.name;
	$('version').textContent = manifest.version;

	if (internals.settings) {
		// update appearance
		$('main-container').classList.remove('hidden');
		updateIcon(internals);
		updateMainContainer(internals);

		// listen config link click
		$('configurator').addEventListener('click', handleOptionLinkClick);

		// listen checkbox clicks
		document.body.addEventListener('click', handleCheckboxClick);

		// listen exntension messages
		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			handleMessage(request)
				.catch(err => {
					log(`exception ${err.stack}`);
				})
				.finally(() => {
					sendResponse(true);
				});
			return true;
		});
	}
	else {
		$('error-container').classList.remove('hidden');
	}
});
