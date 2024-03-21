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

import {$, delay, empty, debounce} from './utils.js';
import {getStyle} from './popup-style.js';

/*
 * consts
 */

const randKey = Math.trunc(Math.random() * 0x80000000).toString(16);
const randId = `appsweets-imo-${randKey}`;
const lineToShortStateMap = new Map([
	['direct',          'en'],
	['alnum',           'A_'],
	['alnum-wide',      'Ａ'],
	['hiragana',        'あ'],
	['katakana',        'ア'],
	['katakana-narrow', 'ｱ_']
]);
const stateToLineMap = new Map;

const speech = (() => {
	const lineToAudioMap = new Map;
	let currentVoice;

	function getAudioFromLine (line) {
		if (lineToAudioMap.has(line)) {
			return Promise.resolve(lineToAudioMap.get(line));
		}
		else {
			return new Promise(resolve => {
				const audio = new Audio(chrome.runtime.getURL(`voice/${line}.mp3`));
				lineToAudioMap.set(line, audio);
				audio.loop = false;
				audio.addEventListener('loadeddata', e => {
					resolve(audio);
				}, {once: true});
			});
		}
	}

	function play (line) {
		pause();
		getAudioFromLine(line)
			.then(audio => {
				if (audio) {
					currentVoice = audio;
					currentVoice.currentTime = 0;
					currentVoice.volume = settings.volume;
					return Promise.all([
						currentVoice.play(),
						sendNotifyMessage({type: 'notifyPlayAudio'})
					]);
				}
			})
			.catch(err => {
				log(`failed to play: ${err.stack}`);
			});
	}

	function pause () {
		lineToAudioMap.forEach(audio => {
			if (!audio.paused && !audio.ended) {
				audio.pause();
			}
		});
	}

	return {play, pause};
})();

const lastActive = (() => {
	let elements = new Set;
	let resizeCount = 0;
	const observer = new ResizeObserver(entries => {
		if (resizeCount++ == 0) return;
		handleResize(entries);
	});

	const handleResize = debounce(entries => {
		const currentActiveElement = getCurrentActiveElement();
		for (const entry of entries) {
			if (entry.target === currentActiveElement) {
				locatePopup(entry.target, $(`${randId}-pop`));
				break;
			}
		}
	}, 100);

	function getCurrentActiveElement () {
		if (elements.size) {
			for (const el of elements) {
				return $(el.id);
			}
		}
		return null;
	}

	function dumpElements () {
		const logs = ['*** dump active elements ***'];
		for (const el of elements) {
			logs.push(`id: "${el.id}", idState: ${el.idState}`);
		}
		log(logs.join('\n'));
	}

	function memo (el) {
		let idState;	// 0: id exists  1: id exists but empty string  2: id does not exist
		let id;

		if (el.getAttribute('id') !== null) {
			if (el.id !== '') {
				idState = 0;
				id = el.id;
			}
			else {
				idState = 1;
			}
		}
		else {
			idState = 2;
		}
		if (idState !== 0) {
			id = el.id = `appsweets-imo-${randKey}-focused`;
		}

		for (const el of elements) {
			if (el.id === id) return;
		}

		resizeCount = 0;
		elements.add({id, idState});
		observer.observe(el);
		//dumpElements();
	}

	function forget (el) {
		const newElements = new Set;
		for (const value of elements) {
			if ($(value.id) === el) {
				switch (value.idState) {
				case 1:
					el.setAttribute('id', '');
					break;
				case 2:
					el.removeAttribute('id');
					break;
				}
				observer.unobserve(el);
			}
			else {
				newElements.add(value);
			}
			
		}
		elements = newElements;
		//dumpElements();
	}

	return {
		memo, forget,
		get element () {
			return getCurrentActiveElement();
		}
	};
})();

/*
 * variables
 */

let settings;
let lastIMData;

/*
 * functions
 */

function sendNotifyMessage (message) {
	chrome.runtime.sendMessage(message).then(() => {})
}

function log (content, sendToBackground) {
	const now = new Date;
	const h = `00${now.getHours()}`.substr(-2);
	const m = `00${now.getMinutes()}`.substr(-2);
	const s = `00${now.getSeconds()}`.substr(-2);
	if (sendToBackground) {
		sendNotifyMessage({type: 'log', log: `content: ${content}`});
	}
	else {
		console.log(`${h}:${m}:${s} ${content}`);
	}
}

function getTargetElementHTML (target) {
	try {
		return target.outerHTML.substring(0, 32).replace(/[\r\n]/g, '') + '...';
	}
	catch {
		return '(unavailable)';
	}
}

function getShortStateFromLine (line) {
	return lineToShortStateMap.has(line) ? lineToShortStateMap.get(line) : null;
}

function getLineFromState (state) {
	if (stateToLineMap.has(state)) {
		return stateToLineMap.get(state);
	}
	else {
		for (const [line, states] of Object.entries(settings.lines)) {
			if (states.includes(state)) {
				stateToLineMap.set(state, line);
				return line;
			}
		}
		return null;
	}
}

function isContentEditable (el) {
	if (!el) return false;

	/*
	 * special rules that apply only to this extension
	 */

	if (el.shadowRoot) return true;

	/*
	 * orginal check part
	 */

	if (el.isContentEditable) return true;
	if (el.tagName === 'TEXTAREA') return !el.readOnly;
	if (el.tagName === 'INPUT') {
		if (el.readOnly) return false;
		return settings.inputTypes.includes(el.type);
	}

	return false;
}

function isStyleUpdated (style) {
	/*
	 * This function must be use '?.' operator
	 * because it may be called even when 'settings' is undefined.
	 */
	return style.backgroundColor !== settings?.style.backgroundColor
		|| style.color !== settings?.style.color;
}

function isIMDataUpdated (data) {
	return data.enable !== lastIMData?.enable
		|| data.keyboard !== lastIMData?.keyboard
		|| data.longState !== lastIMData?.longState
		|| data.shortState !== lastIMData?.shortState;
}

function isFixedPosition (el) {
	for (; el && el instanceof HTMLElement; el = el.parentNode) {
		if (window.getComputedStyle(el).position === 'fixed') {
			return true;
		}
	}

	return false;
}

function createStyle () {
	let el = $(`${randId}-style`);
	if (!el) {
		el = document.head.appendChild(document.createElement('style'));
		el.type = 'text/css';
		el.id = `${randId}-style`;
	}

	empty(el);
	el.appendChild(document.createTextNode(getStyle(randId, settings.style)));
}

function setTargetStyle (target, isActive) {
	if (isActive) {
		target.classList.add(randId);
	}
	else {
		target.classList.remove(randId);
		if (target.getAttribute('class') === '') {
			target.removeAttribute('class');
		}
	}
}

async function locatePopup (target, popup) {
	if (!popup) return;

	// a little dirty hack...
	const codeMirrorContainer = target.closest('.CodeMirror');
	if (codeMirrorContainer) {
		target = codeMirrorContainer;
	}

	const LOOP_SENTINEL_COUNT = 10;
	const rect = target.getBoundingClientRect();
	let lastLeft = rect.left + window.scrollX;
	let lastTop = rect.top + window.scrollY;

	for (let i = 0; i < LOOP_SENTINEL_COUNT; i++) {
		await delay(1000 * 0.1);

		const targetStyle = window.getComputedStyle(target);
		const rect = target.getBoundingClientRect();
		const targetLeft = rect.left + window.scrollX;
		const targetTop = rect.top + window.scrollY;
		//log(`locatePopup: target: ${rect.left} x ${rect.top}, ${getTargetElementHTML(target)}`);

		let popupLeft = targetLeft +
			parseInt(targetStyle['border-left-width'], 10) +
			parseInt(targetStyle['padding-left'], 10);
		let popupRight;
		let popupTop = targetTop - popup.offsetHeight - 6;

		popup.classList.remove(`${randId}-pop-up`);
		popup.classList.remove(`${randId}-pop-down`);

		// clip for horizontal direction
		if (popupLeft < window.scrollX) {
			popupLeft = window.scrollX;
		}

		// clip for vertical direction
		if (popupTop < window.scrollY) {
			if (rect.left > popup.offsetWidth + 6) {
				// locate the popup next to the left of the target
				popup.classList.add(`${randId}-pop-left`);
				popupRight = targetLeft - popup.offsetWidth - 6;
				if (target.nodeName === 'INPUT') {
					popupTop = targetTop + (rect.height / 2) - (popup.offsetHeight / 2);
				}
				else {
					popupTop = targetTop +
						parseInt(targetStyle['border-top-width'], 10) +
						parseInt(targetStyle['padding-top'], 10);
				}
				popupLeft = undefined;
			}
			else {
				// locate the popup below the target
				popup.classList.add(`${randId}-pop-down`);
				popupTop = targetTop + target.offsetHeight + 6;
			}
		}
		else {
			popup.classList.add(`${randId}-pop-up`);
		}

		popupTop = Math.max(
			window.scrollY, Math.min(
				popupTop,
				window.scrollY + document.documentElement.clientHeight - popup.offsetHeight));

		if (isFixedPosition(target)) {
			popup.style.position = 'fixed';
			popup.style.left = `${(popupLeft ?? popupRight) - window.scrollX}px`;
			popup.style.top = `${popupTop - window.scrollY}px`;
		}
		else {
			popup.style.left = `${popupLeft ?? popupRight}px`;
			popup.style.top = `${popupTop}px`;
		}

		popup.style.visibility = 'visible';

		if (targetLeft === lastLeft && targetTop === lastTop) {
			break;
		}

		lastLeft = targetLeft;
		lastTop = targetTop;
	}
}

function showPopup (target, popupContent, isActive) {
	let el = $(`${randId}-pop`);

	if (typeof popupContent === 'object' || typeof popupContent === 'string') {
		if (!el) {
			el = document.body.appendChild(document.createElement('div'));
			el.className = `${randId}-pop ${randId}-pop-up`;
			el.id = `${randId}-pop`;
		}

		if (typeof popupContent === 'object') {
			const line = getLineFromState(popupContent.longState);
			const shortState = getShortStateFromLine(line);

			empty(el);
			el.appendChild(document.createElement('span')).textContent =
				shortState ?? popupContent.shortState;
			el.appendChild(document.createElement('small')).textContent =
				popupContent.keyboard;
		}
		else {
			el.textContent = popupContent;
		}

		el.classList.remove(`${randId}-pop-active`);
		el.classList.remove(`${randId}-pop-deactive`);

		if (isActive) {
			el.classList.add(`${randId}-pop-active`);
		}
		else {
			el.classList.add(`${randId}-pop-deactive`);
		}

		locatePopup(target, el);
	}
	else {
		if (el) {
			el.parentNode.removeChild(el);
		}
	}
}

const handleFocusInCore = debounce(e => {
	//log(`    handleFocusInCore, target: ${e?.target?.tagName ?? '(N/A)'}`);
	const target = e.target;
	if (!isContentEditable(target)) return;

	lastActive.memo(target);
	const isActive = settings.coloredStates.includes(lastIMData.longState);

	// target element styling
	if (settings.enable && settings.enableStyle) {
		setTargetStyle(target, isActive);
	}
	else {
		setTargetStyle(target, false);
	}

	// popup
	if (settings.enable && settings.enablePopup) {
		showPopup(target, lastIMData, isActive);
	}
	else {
		showPopup(target);
	}

	// speech
	if (settings.enable && settings.enableSpeech
	 && Date.now() - lastIMData.lastAudioPlayedTime >= settings.speechIntervalSecs * 1000) {
		const line = getLineFromState(lastIMData.longState);
		if (line) {
			speech.play(line);
		}
	}
}, 50);

/*
 * event handlers
 */

function handleFocusIn (e) {
	if (!e.target) return;
	sendNotifyMessage({type: 'notifyFocusIn', name: e.target.tagName});
}

function handleFocusOut (e) {
	const target = e.target;
	if (!target) return;

	setTargetStyle(target, false);
	showPopup(target);
	lastActive.forget(target);
}

async function handleMessage (message) {
	//log(`*** handleMessage${message.data ? (': ' + message.data.shortState) : ''} ***`);
	if (message.settings) {
		const needCreateStyle = isStyleUpdated(message.settings.style);
		settings = message.settings;

		if (needCreateStyle) {
			createStyle();
		}
	}

	if (message.data) {
		const needDispatchEvent = isIMDataUpdated(message.data);
		lastIMData = message.data;

		if (!settings) {
			const message2 = await chrome.runtime.sendMessage({
				type: 'queryInternals',
				name: document.activeElement?.tagName
			});
			await handleMessage(message2);
		}

		if (document.activeElement) {
			if (needDispatchEvent || document.activeElement !== lastActive.element) {
				handleFocusInCore({target: document.activeElement});
			}
		}
	}

	switch (message.type) {
	case 'invalidate-settings':
		//log(`got invalidate-settings message on ${location.href}`);
		settings = undefined;
		stateToLineMap.clear();
		break;
	}
}

export function run () {
	document.addEventListener('focusin', handleFocusIn, true);
	document.addEventListener('focusout', handleFocusOut, true);
}

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
