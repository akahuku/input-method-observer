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

import {$, delay, empty, debounce} from '../lib/utils.js';
import {getStyle} from '../lib/popup-style.js';

/*
 * consts
 */

const outputMap = {
	'style/background-color': (output, input) => {
		if (!$('dyn-style').disabled) {
			updateStyle(output, input);
		}
		output.textContent = input.value;
	},
	'style/color': 'style/background-color',
	'style/border-color': 'style/background-color',
	'volume': (output, input) => {
		output.textContent = Math.trunc(input.value * 100) + '%';
	}
};

const updateStyle = debounce(async (output, input) => {
	const dynStyle = $('dyn-style');
	const {settings} = await chrome.runtime.sendMessage({type: 'queryInternals'});
	const subSettings = {style: settings.style};

	collectSettings(subSettings);

	empty(dynStyle);
	dynStyle.appendChild(document.createTextNode(getStyle('opt', subSettings.style)));
}, 200);

/*
 * functions
 */

function appendInputMethodMessage (message) {
	const container = $('im-log');
	if (!container) return;

	const div = container.appendChild(document.createElement('div'));
	div.textContent = JSON.stringify(message, null, '\t');

	while (container.children.length > 100) {
		container.removeChild(container.children[0]);
	}

	container.scrollTop = container.scrollHeight - container.clientHeight;
}

function toSnakeCase (s) {
	return s.replace(/([a-z])([A-Z])/g, ($0, a, b) => `${a}-${b.toLowerCase()}`);
}

function regalizeColor (s) {
	if (/^#[0-9a-fA-F]{3}$/.test(s)) {
		const r = s.charAt(1);
		const g = s.charAt(2);
		const b = s.charAt(3);
		return `#${r}${r}${g}${g}${b}${b}`;
	}
	return s;
}

function renderSettings (s, prefix = '') {
	if (Array.isArray(s)) {
		const target = $(toSnakeCase(prefix));
		if (target) {
			if (target.nodeName === 'TEXTAREA') {
				target.value = s.join('\n');
			}
			target.dispatchEvent(new InputEvent('input', {target}));
		}
	}
	else if (typeof s !== 'object') {
		const target = $(toSnakeCase(prefix));
		if (target) {
			if (target.nodeName === 'INPUT' && target.type === 'checkbox') {
				target.checked = !!s;
			}
			else if (target.nodeName === 'INPUT' && /^(?:color)$/.test(target.type)) {
				target.value = regalizeColor('' + s);
			}
			else if (target.nodeName === 'INPUT' && /^(?:number|range|text)$/.test(target.type)) {
				target.value = '' + s;
			}
			target.dispatchEvent(new InputEvent('input', {target}));
		}
	}
	else {
		for (const [key, value] of Object.entries(s)) {
			renderSettings(value, `${prefix}/${key}`.replace(/^\//, ''));
		}
	}
}

function setProperty (object, path, value) {
	const keys = path.split('/');
	while (keys.length) {
		const key = keys.shift();
		if (!(key in object)) {
			throw new Error(`invalid path: ${path}, "${key}" not found`);
		}
		if (!Array.isArray(object[key]) && typeof object[key] === 'object') {
			object = object[key];
		}
		else {
			if (keys.length) {
				throw new Error(`invalid path: ${path}`);
			}
			if (Array.isArray(object[key]) && !Array.isArray(value)
			 || typeof object[key] !== typeof value) {
				throw new Error(`type unmatch: ${path}, ${value} (${typeof object[key]} : ${typeof value})`);
			}
			//console.log(`    assign to ${path}: ${object[key]} -> ${value}`);
			object[key] = value;
		}
	}
}

function collectSettings (root, s, prefix = '') {
	if (prefix === '') {
		s = root;
	}
	if (Array.isArray(s)) {
		const target = $(toSnakeCase(prefix));
		if (target) {
			if (target.nodeName === 'TEXTAREA') {
				setProperty(
					root, prefix,
					target.value.split('\n').filter(line => !/^\s*$/.test(line)));
			}
		}
	}
	else if (typeof s !== 'object') {
		const target = $(toSnakeCase(prefix));
		if (target) {
			if (target.nodeName === 'INPUT' && target.type === 'checkbox') {
				setProperty(root, prefix, target.checked);
			}
			else if (target.nodeName === 'INPUT' && /^(?:number|range)$/.test(target.type)) {
				if (target.step === '' || target.step === '1') {
					setProperty(root, prefix, parseInt(target.value, 10));
				}
				else {
					setProperty(root, prefix, parseFloat(target.value));
				}
			}
			else if (target.nodeName === 'INPUT' && /^(?:color|text)$/.test(target.type)) {
				setProperty(root, prefix, target.value);
			}
		}
	}
	else {
		for (const [key, value] of Object.entries(s)) {
			collectSettings(root, value, `${prefix}/${key}`.replace(/^\//, ''));
		}
	}
}

function showPopup (target, caption1, caption2) {
	const pop = target.insertBefore(document.createElement('div'), target.firstChild);
	pop.className = 'opt-pop opt-pop-up opt-pop-active';
	target.style.position = 'relative';

	if (caption1) {
		pop.appendChild(document.createElement('span')).textContent = caption1;
	}
	if (caption2) {
		pop.appendChild(document.createElement('small')).textContent = caption2;
	}

	setTimeout(() => {
		const rect = target.getBoundingClientRect();
		pop.style.top = `${-pop.offsetHeight - 6}px`;
		pop.style.left = `${rect.width - pop.offsetWidth - 16}px`;
		pop.style.visibility = 'visible';
	}, 1);
}

async function playAudio (target) {
	if (target.dataset.playing === '1') return;

	target.dataset.playing = '1';
	try {
		const tr = target.closest('tr');
		if (!tr) return;

		const textarea = tr.querySelector('textarea');
		let re;
		if (!textarea || !(re = /^lines\/([a-zA-Z0-9_-]+)$/.exec(textarea.id))) return;

		const audio = new Audio(`voice/${re[1]}.mp3`);
		await new Promise(resolve => {
			audio.addEventListener('loadeddata', resolve, {once: true});
		});

		audio.loop = false;
		audio.currentTime = 0;
		audio.volume = parseFloat($('volume').value);
		await audio.play();
	}
	finally {
		delete target.dataset.playing;
	}
}

async function saveSettings (target) {
	if (target.dataset.saving === '1') return;

	const span = target.querySelector('span');
	const textContent = span.textContent;
	target.dataset.saving = '1';
	try {
		const {settings} = await chrome.runtime.sendMessage({type: 'queryInternals'});
		collectSettings(settings);
		console.dir(settings);

		await chrome.runtime.sendMessage({type: 'updateSettings', settings});

		span.textContent = '保存しました';
		await delay(1000 * 3);
	}
	finally {
		span.textContent = textContent;
		delete target.dataset.saving;
	}
}

async function resetSettings (target) {
	if (target.dataset.saving === '1') return;
	if (!confirm('設定をすべてリセットします。\nよろしいですか？')) return;

	const span = target.querySelector('span');
	const textContent = span.textContent;
	target.dataset.saving = '1';
	try {
		const {settings} = await chrome.runtime.sendMessage({type: 'resetSettings'});

		span.textContent = 'リセットしました';
		renderSettings(settings);
		await delay(1000 * 3);
	}
	finally {
		span.textContent = textContent;
		delete target.dataset.saving;
	}
}

/*
 * event handlers
 */

function handleBodyClick (e) {
	const link = e.target.closest('a');
	if (link) {
		switch (link.hash) {
		case '#play':
			e.preventDefault();
			playAudio(link).catch(err => {
				console.error(err.stack);
			});
			break;

		case '#save':
			e.preventDefault();
			saveSettings(link).catch(err => {
				console.error(err.stack);
			});
			break;

		case '#reset':
			e.preventDefault();
			resetSettings(link).catch(err => {
				console.error(err.stack);
			});
			break;
		}
	}
}

function handleBodyInput (e) {
	let handler = outputMap[e.target.id];
	if (typeof handler === 'string') {
		handler = outputMap[handler];
	}
	if (typeof handler === 'function') {
		document.querySelectorAll(`output[for="${e.target.id}"]`).forEach(node => {
			try {
				const result = handler.call(outputMap, node, e.target);
				if (result instanceof Promise) {
					result.catch(err => {
						console.error(err.stack);
					});
				}
			}
			catch (err) {
				console.error(err.stack);
			}
		});
	}
}

function handleStorageChanged (changes, areaName) {
	if (areaName !== 'local') return;
	for (const [key, {oldValue, newValue}] of Object.entries(changes)) {
		if (!/^(?:enable|enableStyle|enableSpeech|enablePopup)$/.test(key)) continue;

		const target = $(toSnakeCase(key));
		if (!target) continue;

		target.checked = newValue;
		target.dispatchEvent(new InputEvent('input', {target}));
	}
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
]).then(([{settings}, ]) => {
	const manifest = chrome.runtime.getManifest();
	$('product').textContent = manifest.name;
	$('version').textContent = manifest.version_name;

	document.body.addEventListener('click', handleBodyClick, true);
	document.body.addEventListener('input', handleBodyInput, true);

	chrome.storage.onChanged.addListener(handleStorageChanged);
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.data && document.activeElement.id === 'im-tester') {
			appendInputMethodMessage(message.data);
		}
	});

	const dynStyle = $('dyn-style');
	dynStyle.appendChild(document.createTextNode(getStyle('opt', settings.style)));
	dynStyle.disabled = true;

	showPopup($('style-options'), 'こんな感じになります');
	showPopup($('popup-options'), 'こんな感じに', 'なります');

	renderSettings(settings);
	dynStyle.disabled = false;
}).catch(err => {
	console.error(err.stack);
});
